// portal/portal.js — προβολή στατιστικών ΜΟΝΟ της κλινικής του συνδεδεμένου πελάτη.
// Η βάση (RLS) εγγυάται ότι βλέπει αποκλειστικά τα δικά του monthly_stats & campaigns.
import { currentSession, sessionRole, logout } from '/app/shared/auth.js';
import { rest, updatePassword, callFunction } from '/app/shared/supabase.js';
import { esc, eur, num, mLabel, nowMonth, todayISO, addDays } from '/app/shared/util.js';
import * as gcal from '/app/shared/gcal.js';
gcal.useClientAuth(); // ο πελάτης συνδέει το ΔΙΚΟ του Google Calendar (client-gcal-auth), όχι της ομάδας

if (!currentSession()) location.replace('/login/');
const role = sessionRole();
if (role.role !== 'client') location.replace('/portal/');
else document.documentElement.classList.add('authed');

document.getElementById('btnLogout').onclick = () => { logout(); location.href = '/login/'; };
document.getElementById('pClinic').textContent = role.clinicName || 'Η κλινική σας';

const toCamel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

function delta(cur, prev) {
  if (prev == null || !(+prev)) return '';
  const d = Math.round(100 * ((+cur) - (+prev)) / (+prev));
  if (!isFinite(d) || d === 0) return '';
  return ` <span class="${d > 0 ? 'up' : 'down'}" style="color:${d > 0 ? 'var(--good)' : 'var(--crit)'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
}
function tile(lb, v, d) {
  return `<div class="tile"><div class="lb">${lb}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
}

/* Μικρό grouped bar chart σε καθαρό SVG — μία κλίμακα, hover titles. */
function bars(labels, series, fmt) {
  const W = 560, H = 200, padL = 40, padR = 8, padT = 10, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...series.flatMap((s) => s.vals));
  const p = Math.pow(10, Math.floor(Math.log10(max))); const d0 = max / p;
  const nice = (d0 <= 1 ? 1 : d0 <= 2 ? 2 : d0 <= 4 ? 4 : d0 <= 5 ? 5 : d0 <= 8 ? 8 : 10) * p;
  const y = (v) => padT + ih - (v / nice) * ih;
  const gw = iw / labels.length;
  const bw = Math.min(24, (gw - 10) / series.length);
  let grid = '', out = '', lab = '';
  for (let g = 0; g <= 4; g++) {
    const v = nice * g / 4; const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--hair2)"/><text x="${padL - 5}" y="${yy + 4}" text-anchor="end">${v >= 1000 ? (v / 1000) + 'k' : Math.round(v)}</text>`;
  }
  labels.forEach((m, i) => {
    const cx = padL + gw * i + gw / 2;
    lab += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(m)}</text>`;
    series.forEach((s, j) => {
      const v = s.vals[i];
      const x = cx - (series.length * bw + 2 * (series.length - 1)) / 2 + j * (bw + 2);
      out += `<rect x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(v > 0 ? 2 : 0, (v / nice) * ih)}" rx="3" fill="${s.color}"><title>${esc(m + ' · ' + s.name + ': ' + fmt(v))}</title></rect>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img">${grid}${out}${lab}</svg>`;
}

/* Funnel πορείας: leads → ραντεβού → ήρθαν → ασθενείς */
function funnel(s) {
  const steps = [
    ['Ενδιαφερόμενοι', +s.leads, 'var(--c2)'],
    ['Ραντεβού', +s.rv, 'var(--chip-rv)'],
    ['Ήρθαν', +s.shows, 'var(--chip-show)'],
    ['Νέοι ασθενείς', +s.sales, 'var(--good)'],
  ];
  const max = Math.max(1, steps[0][1]);
  return `<div style="display:flex;flex-direction:column;gap:8px;padding:14px 16px">` + steps.map(([lb, v], i) => {
    const pct = steps[0][1] ? Math.round(100 * v / steps[0][1]) : 0;
    return `<div style="display:flex;align-items:center;gap:10px;font-size:12.5px">
      <span style="width:110px;color:var(--soft)">${lb}</span>
      <span style="flex:1;height:18px;background:var(--card2);border-radius:6px;overflow:hidden">
        <span style="display:block;height:100%;width:${Math.max(v > 0 ? 4 : 0, 100 * v / max)}%;background:${steps[i][2]};border-radius:6px"></span></span>
      <b class="mono" style="width:60px;text-align:right">${num(v)}</b>
      <span class="mono" style="width:44px;text-align:right;color:var(--soft)">${i ? pct + '%' : ''}</span>
    </div>`;
  }).join('') + '</div>';
}

/* Στάδια με λόγια πελάτη */
const P_STAGE = {
  neo: ['Νέα επικοινωνία', 'neo'], epik: ['Σε επικοινωνία', 'epik'],
  rv: ['Ραντεβού κλεισμένο', 'rv'], show: ['Ήρθε στο ιατρείο', 'show'],
  won: ['Ξεκίνησε θεραπεία', 'won'], lost: ['Δεν προχώρησε', 'lost'],
};
let pTab = 'stats';
let D = { stats: [], camps: [], leads: [] };
document.getElementById('pTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ptab]'); if (!b) return;
  pTab = b.dataset.ptab;
  document.querySelectorAll('#pTabs button').forEach((x) => x.classList.toggle('on', x.dataset.ptab === pTab));
  renderRoot();
});

async function load() {
  const body = document.getElementById('pBody');
  let stats, camps, leads, bills = [], clinic = null;
  try {
    [stats, camps, leads] = await Promise.all([
      rest('monthly_stats?select=*&order=month.desc&limit=24'),
      rest('campaigns?select=*&order=month.desc&limit=100'),
      rest('client_leads?select=*&order=created_time.desc&limit=500'),
    ]);
    /* Οφειλές: προαιρετικά — αν ο server δεν τα δίνει ακόμα, το tab απλώς δεν εμφανίζεται. */
    try {
      [bills, clinic] = await Promise.all([rest('billing?select=*&period=eq.week&order=period_start.desc&limit=60'), rest('client_clinic?select=*')]);
      clinic = clinic && clinic[0] ? toCamel(clinic[0]) : null;
    } catch { bills = []; clinic = null; }
  } catch (e) {
    if (String(e.message).includes('session')) { location.href = '/login/'; return; }
    body.innerHTML = '<div class="card empty">Πρόβλημα φόρτωσης: ' + esc(e.message) + '</div>';
    return;
  }
  stats = stats.map(toCamel); camps = camps.map(toCamel);
  D = { stats, camps, leads: leads.map(toCamel), bills: (bills || []).map(toCamel), clinic };
  const open = D.bills.filter((b) => (b.payStatus || 'pending') !== 'paid').length;
  document.getElementById('billsTab').hidden = !clinic;
  const bb = document.getElementById('billBadge'); bb.textContent = open; bb.style.display = open ? '' : 'none';
  const pend = D.leads.filter((l) => l.status === 'rv').length;
  const bd = document.getElementById('apptBadge');
  bd.textContent = pend; bd.style.display = pend ? '' : 'none';
  renderRoot();
}

/* Κέρδος κλινικής (χωρίς ΦΠΑ): έσοδα νέων ασθενών ÷ 1,24 − διαφημιστική δαπάνη − αμοιβή astra. */
const netRev = (s) => (+s.revenue || 0) / 1.24;
const profitOf = (s) => +(netRev(s) - (+s.spend || 0) - (+s.agencyIncome || 0)).toFixed(2);
const roiOf = (s) => { const cost = (+s.spend || 0) + (+s.agencyIncome || 0); return cost > 0 ? profitOf(s) / cost : 0; };
function profitBlock(list, title) {
  const rev = list.reduce((a, s) => a + netRev(s), 0), spend = list.reduce((a, s) => a + (+s.spend || 0), 0), fee = list.reduce((a, s) => a + (+s.agencyIncome || 0), 0);
  const profit = rev - spend - fee, cost = spend + fee;
  if (!rev && !spend) return '';
  const row = (lb, v, cls) => `<div class="todayrow" style="justify-content:space-between"><span${cls ? ` style="${cls}"` : ''}>${lb}</span><b class="mono"${cls ? ` style="${cls}"` : ''}>${v}</b></div>`;
  return `<h3 class="sectionhead">${title}</h3>
    <div class="card section">
      ${row('Έσοδα από νέους ασθενείς (χωρίς ΦΠΑ)', eur(rev))}
      ${row('− Διαφημιστική δαπάνη', '− ' + eur(spend))}
      ${row('− Αμοιβή astra', '− ' + eur(fee))}
      ${row('= Καθαρό κέρδος σας', eur(profit), 'color:var(--good);font-size:16px')}
      ${cost > 0 ? row('Για κάθε 1 € που επενδύσατε (δαπάνη + αμοιβή)', 'πήρατε πίσω ' + (1 + profit / cost).toFixed(2) + ' €') : ''}
    </div>`;
}
function render() {
  const { stats, camps } = D;
  const body = document.getElementById('pBody');
  const mk = nowMonth();
  const cur = stats.find((s) => s.month === mk);
  const past = stats.filter((s) => s.month < mk);
  const prev = past[0];
  if (cur && cur.computedAt) {
    document.getElementById('pUpdated').textContent = 'Τελευταία ενημέρωση: '
      + new Date(cur.computedAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  const hasAnything = (cur && (cur.leads || cur.spend)) || past.some((s) => s.leads || s.spend) || camps.length;
  if (!hasAnything) {
    body.innerHTML = `<div class="card empty" style="padding:56px 28px">
      <div class="big">Η συνεργασία μας ξεκινά! 🚀</div>
      Μόλις τρέξουν οι πρώτες καμπάνιες, εδώ θα βλέπετε ζωντανά:
      νέα ενδιαφερόμενα άτομα, ραντεβού, νέους ασθενείς, έσοδα και την απόδοση κάθε ευρώ διαφήμισης.
    </div>
    <p style="color:var(--soft);font-size:12.5px;margin-top:26px;text-align:center">Η ομάδα της Astra Marketing · info@astramarketing.gr</p>`;
    return;
  }

  const c = cur || { leads: 0, rv: 0, shows: 0, sales: 0, revenue: 0, spend: 0, cpl: 0, roas: 0 };
  const tiles = `<div class="tiles section">
      ${tile('Νέα ενδιαφερόμενα · ' + mLabel(mk), num(c.leads) + delta(c.leads, prev && prev.leads), '')}
      ${tile('Ραντεβού', num(c.rv) + delta(c.rv, prev && prev.rv), c.leads ? Math.round(100 * c.rv / c.leads) + '% των ενδιαφερομένων' : '')}
      ${tile('Ήρθαν στο ιατρείο', num(c.shows), c.rv ? Math.round(100 * c.shows / c.rv) + '% των ραντεβού' : '')}
      ${tile('Νέοι ασθενείς', num(c.sales) + delta(c.sales, prev && prev.sales), '')}
      ${tile('Έσοδα από νέους ασθενείς', eur(c.revenue), '')}
      ${tile('Διαφημιστική δαπάνη', eur(c.spend), '')}
      ${tile('Κόστος ανά ενδιαφερόμενο', c.cpl ? eur(c.cpl) : '—', 'Cost per Lead')}
      ${tile('Κόστος ανά ραντεβού', c.rv && c.spend ? eur(c.spend / c.rv) : '—', 'Cost per Booking')}
      ${tile('Απόδοση (ROAS)', c.spend > 0 ? (+c.roas).toFixed(2) + '×' : '—', 'έσοδα ÷ δαπάνη')}
      ${tile('Καθαρό κέρδος σας · ' + mLabel(mk), `<span style="color:var(--good)">${eur(profitOf(c))}</span>`, 'μετά τη δαπάνη και την αμοιβή astra')}
      ${(() => { const e = currentWeekEstimate(); const open = D.bills.filter((b) => (b.payStatus || 'pending') !== 'paid').reduce((s, b) => s + (+b.gross || 0), 0); return D.clinic ? tile('Οφειλή προς astra', eur(open + (e ? e.gross : 0)), (open ? eur(open) + ' ανοιχτό' : 'τίποτα ανοιχτό') + (e ? ' · ' + eur(e.gross) + ' τρέχουσα εβδ.' : '')) : ''; })()}
    </div>`;

  const funnelHtml = `<h3 class="sectionhead">Η πορεία του μήνα</h3><div class="card section">${funnel(c)}</div>`
    + profitBlock(stats, 'Η συνεργασία μας σε αριθμούς · από την αρχή');

  // Γράφημα 6 μηνών (παρελθόν + τρέχων)
  const last6 = [...past.slice(0, 5)].reverse().concat(cur ? [cur] : []);
  const chartHtml = last6.length >= 2 ? `<h3 class="sectionhead">Εξέλιξη</h3>
    <div class="card section"><div class="charthead"><h3>Ενδιαφερόμενοι & νέοι ασθενείς ανά μήνα</h3>
      <div class="legend"><span><i style="background:var(--c2)"></i>Ενδιαφερόμενοι</span><span><i style="background:var(--c3)"></i>Νέοι ασθενείς</span></div></div>
      <div style="padding:4px 10px 10px">${bars(last6.map((s) => mLabel(s.month)),
        [{ name: 'Ενδιαφερόμενοι', vals: last6.map((s) => +s.leads || 0), color: 'var(--c2)' },
         { name: 'Νέοι ασθενείς', vals: last6.map((s) => +s.sales || 0), color: 'var(--c3)' }], (v) => num(v))}</div></div>` : '';

  const hist = past.length ? `<h3 class="sectionhead">Ιστορικό ανά μήνα</h3>
    <div class="card tablewrap section"><table><thead><tr><th>Μήνας</th><th class="num">Ενδιαφ.</th><th class="num">Ραντεβού</th><th class="num">Ήρθαν</th><th class="num">Ασθενείς</th><th class="num">Έσοδα</th><th class="num">Κέρδος σας</th><th class="num">Δαπάνη</th><th class="num">€/Lead</th><th class="num">€/Ραντ.</th><th class="num">ROAS</th></tr></thead><tbody>
      ${past.map((s) => `<tr><td class="mono"><b>${mLabel(s.month)}</b></td><td class="num">${s.leads}</td><td class="num">${s.rv}</td><td class="num">${s.shows}</td><td class="num">${s.sales}</td><td class="num">${eur(s.revenue)}</td><td class="num" style="color:var(--good)"><b>${eur(profitOf(s))}</b></td><td class="num">${eur(s.spend)}</td><td class="num">${s.cpl ? eur(s.cpl) : '—'}</td><td class="num">${s.rv && s.spend ? eur(s.spend / s.rv) : '—'}</td><td class="num">${s.spend > 0 ? (+s.roas).toFixed(2) + '×' : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '';

  const campsHtml = camps.length ? `<h3 class="sectionhead">Οι καμπάνιες σας</h3>
    <div class="card tablewrap"><table><thead><tr><th>Καμπάνια</th><th>Μήνας</th><th class="num">Δαπάνη</th><th class="num">Προβολές</th><th class="num">Clicks</th></tr></thead><tbody>
      ${camps.slice(0, 20).map((x) => `<tr><td><b>${esc(x.name)}</b><div style="font-size:11.5px;color:var(--soft)">${esc(x.platform || '')}</div></td><td class="mono">${x.month ? mLabel(x.month) : '—'}</td><td class="num">${eur(x.spend)}</td><td class="num">${num(x.impressions)}</td><td class="num">${num(x.clicks)}</td></tr>`).join('')}
    </tbody></table></div>` : '';

  body.innerHTML = tiles + funnelHtml + chartHtml + hist + campsHtml
    + '<p style="color:var(--soft);font-size:12.5px;margin-top:26px">Τα στοιχεία ενημερώνονται από την ομάδα της Astra Marketing. Για οτιδήποτε χρειαστείτε: info@astramarketing.gr</p>';
}

/* ---- Tab «Ραντεβού»: επιβεβαίωση ποιος ήρθε ---- */
function renderAppts() {
  const body = document.getElementById('pBody');
  const _n = new Date(); const today = _n.getFullYear() + '-' + String(_n.getMonth() + 1).padStart(2, '0') + '-' + String(_n.getDate()).padStart(2, '0');
  const rv = D.leads.filter((l) => l.status === 'rv').sort((a, b) => String(a.nextAction || '9999').localeCompare(String(b.nextAction || '9999')));
  const shown = D.leads.filter((l) => l.status === 'show').sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime))).slice(0, 15);
  const row = (l) => `<div class="todayrow" data-id="${l.id}">
      <div class="who"><b>${esc(l.name)}</b><div class="sub">${esc(l.phone || '')}</div></div>
      <span class="due ${l.nextAction && l.nextAction < today ? 'over' : ''}">${l.nextAction ? new Date(l.nextAction).toLocaleDateString('el-GR', { weekday: 'short', day: 'numeric', month: 'short' }) : 'χωρίς ημερομηνία'}</span>
      <div class="acts">
        <button class="btn small primary" data-mark="1">✓ Έγινε</button>
        <button class="btn small" data-mark="0">Δεν ήρθε</button>
      </div></div>`;
  body.innerHTML = `
    <h3 class="sectionhead" style="margin-top:0">Κλεισμένα ραντεβού <span class="chip rv">${rv.length}</span></h3>
    <p style="color:var(--soft);font-size:13px;margin:-4px 0 12px">Επιβεβαιώστε ποιοι προσήλθαν — έτσι τα στατιστικά σας μένουν ακριβή και η ομάδα μας κάνει follow-up σε όσους δεν ήρθαν.</p>
    <div class="card section">${rv.length ? rv.map(row).join('') : '<div class="empty">Κανένα εκκρεμές ραντεβού.</div>'}</div>
    ${shown.length ? `<h3 class="sectionhead">Επιβεβαιωμένα — ήρθαν <span class="chip show">${shown.length}</span></h3>
    <div class="card">${shown.map((l) => `<div class="todayrow"><div class="who"><b>${esc(l.name)}</b></div><span class="chip show">Ήρθε ✓</span></div>`).join('')}</div>` : ''}`;
}
document.getElementById('pBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mark]'); if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  const attended = b.dataset.mark === '1';
  b.disabled = true; b.textContent = '…';
  try {
    await rest('rpc/client_mark_attended', { method: 'POST', body: { p_lead_id: id, p_attended: attended } });
    await load();
  } catch (err) {
    alertBox(err.message); b.disabled = false; b.textContent = attended ? '✓ Έγινε' : 'Δεν ήρθε';
  }
});
function alertBox(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}

/* ---- Tab «Πορεία ενδιαφερομένων» ---- */
let journeyQ = '';
function renderJourney() {
  const body = document.getElementById('pBody');
  let ls = D.leads;
  if (journeyQ) ls = ls.filter((l) => (l.name + ' ' + (l.phone || '')).toLowerCase().includes(journeyQ.toLowerCase()));
  const counts = Object.keys(P_STAGE).map((k) => `<span class="chip ${P_STAGE[k][1]}">${P_STAGE[k][0]} · ${D.leads.filter((l) => l.status === k).length}</span>`).join('');
  body.innerHTML = `
    <div class="pill-row">${counts}</div>
    <div class="filters"><input id="jSearch" placeholder="Αναζήτηση ονόματος ή τηλεφώνου…" value="${esc(journeyQ)}" style="min-width:240px"></div>
    <div class="card tablewrap"><table><thead><tr><th>Ενδιαφερόμενος</th><th>Ήρθε από</th><th>Ημ/νία</th><th>Στάδιο επικοινωνίας</th><th>Επόμενο βήμα</th></tr></thead><tbody>
      ${ls.length ? ls.map((l) => {
        const st = P_STAGE[l.status] || [l.status, 'plain'];
        const d = l.createdTime ? new Date(l.createdTime) : null;
        return `<tr><td><b>${esc(l.name)}</b><div style="font-size:11.5px;color:var(--soft)" class="mono">${esc(l.phone || '')}</div></td>
          <td style="font-size:12.5px">${esc((l.campaign || '—').replace('Demo — ', ''))}</td>
          <td class="mono">${d && !isNaN(d) ? d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : '—'}</td>
          <td><span class="chip ${st[1]}">${st[0]}</span></td>
          <td style="font-size:12.5px;color:var(--soft)">${l.status === 'rv' && l.nextAction ? 'Ραντεβού ' + new Date(l.nextAction).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : l.status === 'won' ? (l.amount ? eur(l.amount) : '') : l.status === 'lost' ? '—' : 'Η ομάδα μας επικοινωνεί'}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="empty">Τίποτα ακόμα.</td></tr>'}
    </tbody></table></div>`;
  const si = document.getElementById('jSearch');
  si.addEventListener('input', () => { journeyQ = si.value; renderJourney(); const s2 = document.getElementById('jSearch'); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); });
}

/* ---- Tab «Οφειλές»: τι χρωστά η κλινική στην astra — κλείνει κάθε Δευτέρα για την προηγούμενη εβδομάδα ---- */
const isoDay = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function thisWeek() {
  const s = new Date(); s.setHours(12, 0, 0, 0); s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  const e = new Date(s); e.setDate(s.getDate() + 6);
  return { start: isoDay(s), end: isoDay(e) };
}
const wkText = (a, b) => { const f = (x) => new Date(x + 'T12:00:00').toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }); return f(a) + ' – ' + f(b); };
const PAY = { pending: ['Προς πληρωμή', 'epik'], processing: ['Σε επεξεργασία', 'rv'], paid: ['Πληρώθηκε ✓', 'show'], failed: ['Απέτυχε η χρέωση', 'lost'] };
/* Εκτίμηση τρέχουσας εβδομάδας από τα leads (ίδιος κανόνας με το κλείσιμο της Δευτέρας). */
function currentWeekEstimate() {
  const c = D.clinic; if (!c) return null;
  const w = thisWeek(); const share = (c.billingModel || 'appointment') === 'share';
  const inWeek = (d) => d && String(d).slice(0, 10) >= w.start && String(d).slice(0, 10) <= w.end;
  const items = share
    ? D.leads.filter((l) => l.status === 'won' && (+l.amount || 0) > 0 && inWeek(l.saleDate || l.createdTime))
    : D.leads.filter((l) => ['rv', 'show', 'won'].includes(l.status) && inWeek(l.createdTime));
  const net = share ? items.reduce((s, l) => s + (+l.amount || 0) / 1.24, 0) * ((+c.sharePct || 50) / 100) : items.length * (+c.fee || 50);
  return { w, share, n: items.length, net: +net.toFixed(2), gross: +(net * 1.24).toFixed(2), pct: +c.sharePct || 50, fee: +c.fee || 50 };
}
function renderBills() {
  const body = document.getElementById('pBody');
  const est = currentWeekEstimate();
  const open = D.bills.filter((b) => (b.payStatus || 'pending') !== 'paid');
  const due = open.reduce((s, b) => s + (+b.gross || 0), 0);
  const tiles = `<div class="tiles section">
      ${tile('Ανοιχτό υπόλοιπο', eur(due), open.length ? open.length + ' εκκαθαρίσεις προς πληρωμή' : 'Όλα εξοφλημένα ✓')}
      ${est ? tile('Τρέχουσα εβδομάδα (εκτίμηση)', eur(est.gross), (est.share ? `${est.n} πωλήσεις × ${est.pct}% επί καθαρού` : `${est.n} ραντεβού × ${eur(est.fee)}`) + ' · κλείνει τη Δευτέρα') : ''}
      ${tile('Πληρωμένα συνολικά', eur(D.bills.filter((b) => b.payStatus === 'paid').reduce((s, b) => s + (+b.gross || 0), 0)), '')}
    </div>`;
  const how = est ? `<p style="color:var(--soft);font-size:13px;margin:-4px 0 14px">${est.share
    ? `Η αμοιβή της astra είναι ${est.pct}% επί του καθαρού ποσού (χωρίς ΦΠΑ) κάθε πώλησης που κλείνει. Κάθε Δευτέρα κλείνει η εκκαθάριση της προηγούμενης εβδομάδας· τα ποσά παρακάτω περιλαμβάνουν ΦΠΑ 24%.`
    : `Η αμοιβή της astra είναι ${eur(est.fee)} ανά κλεισμένο ραντεβού. Κάθε Δευτέρα κλείνει η εκκαθάριση της προηγούμενης εβδομάδας· τα ποσά παρακάτω περιλαμβάνουν ΦΠΑ 24%.`}</p>` : '';
  const rows = D.bills.map((b) => {
    const pc = PAY[b.payStatus || 'pending'] || PAY.pending;
    const items = b.model === 'share' ? `${b.sales} πωλήσεις × ${+b.sharePct}%` : `${b.appts} ραντεβού × ${eur(+b.fee)}`;
    return `<tr><td class="mono"><b>${wkText(b.periodStart, b.periodEnd)}</b></td><td>${items}</td><td class="num">${eur(+b.total)}</td><td class="num">${eur(+b.vat)}</td><td class="num"><b>${eur(+b.gross)}</b></td><td><span class="chip ${pc[1]}">${pc[0]}</span>${b.paidAt ? `<div style="font-size:11px;color:var(--soft)">${new Date(b.paidAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</div>` : ''}</td></tr>`;
  }).join('');
  body.innerHTML = tiles + `<h3 class="sectionhead">Εβδομαδιαίες εκκαθαρίσεις</h3>` + how
    + `<div class="card tablewrap"><table><thead><tr><th>Εβδομάδα</th><th>Υπολογισμός</th><th class="num">Καθαρό</th><th class="num">ΦΠΑ</th><th class="num">Σύνολο</th><th>Κατάσταση</th></tr></thead><tbody>
      ${rows || '<tr><td colspan="6" class="empty">Καμία εκκαθάριση ακόμα — η πρώτη κλείνει την επόμενη Δευτέρα.</td></tr>'}</tbody></table></div>
    <p style="color:var(--soft);font-size:12.5px;margin-top:22px">Η πληρωμή γίνεται αυτόματα με την πάγια εντολή SEPA, ή με τραπεζική κατάθεση αν δεν έχει ενεργοποιηθεί. Για οτιδήποτε: info@astramarketing.gr</p>`;
}
/* ---- Tab «Ημερολόγιο»: το Google Calendar της κλινικής μέσα στο portal — σύνδεση ΜΙΑ φορά, μετά για πάντα ---- */
const CAL = { status: null, offset: 0, cache: {}, loading: false };
const calMonth = () => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth() + CAL.offset, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
const TIMES = (() => { const o = []; for (let h = 8; h <= 21; h++) for (const m of ['00', '30']) o.push(String(h).padStart(2, '0') + ':' + m); return o; })();
async function calStatus() {
  if (CAL.status) return CAL.status;
  try { CAL.status = await callFunction('client-gcal-auth', { action: 'status' }); }
  catch (e) { CAL.status = { error: e.message }; }
  return CAL.status;
}
function loadCalMonth(mk) {
  if (CAL.cache[mk]) return;
  CAL.cache[mk] = 'loading';
  gcal.listEvents({ clientId: CAL.status.clientId }, CAL.status.calendarId || 'primary', mk)
    .then((evs) => { CAL.cache[mk] = evs; if (pTab === 'calendar') renderCal(); })
    .catch((e) => { CAL.cache[mk] = e.code === 'connect_needed' ? 'connect' : 'error'; if (pTab === 'calendar') renderCal(); });
}
async function renderCal() {
  const body = document.getElementById('pBody');
  const st = await calStatus();
  if (pTab !== 'calendar') return;
  if (st.error) { body.innerHTML = `<div class="card empty">Το ημερολόγιο δεν είναι διαθέσιμο αυτή τη στιγμή (${esc(st.error)}).</div>`; return; }
  if (!st.connected) {
    body.innerHTML = `<div class="card empty" style="padding:48px 28px">
        <div class="big">Το ημερολόγιό σας, μέσα στο portal</div>
        Συνδέστε μία φορά το Google Calendar της κλινικής. Από εκεί και πέρα θα βλέπετε εδώ όλα τα ραντεβού σας και θα προσθέτετε ή θα αλλάζετε ραντεβού απευθείας — αποθηκεύονται στο Google Calendar σας.
        <div style="margin-top:18px"><button class="btn primary" id="btnCalConnect">Σύνδεση με Google</button></div>
        <div class="fhint" style="margin-top:12px">Ζητάμε πρόσβαση μόνο στο ημερολόγιο. Μπορείτε να την αφαιρέσετε όποτε θέλετε από το tab «Λογαριασμός».</div>
      </div>`;
    document.getElementById('btnCalConnect').onclick = async () => {
      const b = document.getElementById('btnCalConnect'); b.disabled = true; b.textContent = 'Σύνδεση…';
      try { await gcal.connectPermanent(st.clientId); CAL.status = null; CAL.cache = {}; alertBox('Το ημερολόγιό σας συνδέθηκε ✓'); renderCal(); }
      catch (e) { alertBox(e.message); b.disabled = false; b.textContent = 'Σύνδεση με Google'; }
    };
    return;
  }
  const mk = calMonth(); loadCalMonth(mk);
  const today = todayISO(), tomorrow = addDays(1);
  const [y, m] = mk.split('-').map(Number);
  const first = new Date(y, m - 1, 1), daysIn = new Date(y, m, 0).getDate(), startDow = (first.getDay() + 6) % 7;
  const gc = CAL.cache[mk];
  const byDate = {};
  if (Array.isArray(gc)) gc.forEach((ev) => { (byDate[ev.date] = byDate[ev.date] || []).push({ ...ev, kind: 'g' }); });
  /* Ραντεβού που έκλεισε η astra από τα leads (ημερομηνία μόνο) — εμφανίζονται ως ένδειξη, δεν επεξεργάζονται εδώ */
  D.leads.filter((l) => l.status === 'rv' && l.nextAction && String(l.nextAction).slice(0, 7) === mk)
    .forEach((l) => { const k = String(l.nextAction).slice(0, 10); (byDate[k] = byDate[k] || []).push({ id: 'lead-' + l.id, title: 'astra: ' + l.name, start: '', kind: 'lead' }); });
  const chip = (ev) => ev.kind === 'lead'
    ? `<span class="calev act" title="${esc(ev.title)}">${esc(ev.title)}</span>`
    : `<button class="calev gev" data-gev="${esc(ev.id)}" title="${esc(ev.title + (ev.start ? ' · ' + ev.start : ''))}">${ev.start ? `<span class="mono">${ev.start}</span> ` : ''}${esc(ev.title)}</button>`;
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="calday dim"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const key = `${mk}-${String(d).padStart(2, '0')}`; const evs = (byDate[key] || []).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    cells += `<div class="calday${key === today ? ' today' : ''}" data-date="${key}"><div class="dn">${d}</div>${evs.slice(0, 5).map(chip).join('')}${evs.length > 5 ? `<div class="calmore">+${evs.length - 5} ακόμα</div>` : ''}${evs.length > 2 ? `<div class="calmore m">+${evs.length - 2}</div>` : ''}</div>`;
  }
  for (let t = startDow + daysIn; t % 7 !== 0; t++) cells += '<div class="calday dim"></div>';
  const days = Object.keys(byDate).filter((k) => k >= today).sort();
  const agenda = days.length ? days.map((k) => `<div class="taskday${k === today ? ' today' : ''}">${new Date(k + 'T12:00:00').toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' })}${k === today ? ' · σήμερα' : k === tomorrow ? ' · αύριο' : ''}</div>`
    + byDate[k].sort((a, b) => String(a.start).localeCompare(String(b.start))).map((ev) => ev.kind === 'lead'
      ? `<div class="agrow" style="cursor:default"><span class="mono">ραντεβού</span><span>${esc(ev.title)}</span></div>`
      : `<button class="agrow" data-gev="${esc(ev.id)}"><span class="mono">${ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : 'όλη μέρα'}</span><span>${esc(ev.title)}</span></button>`).join('')).join('')
    : '<div class="empty">Κανένα επόμενο ραντεβού αυτόν τον μήνα.</div>';
  body.innerHTML = `
    <div class="filters" style="align-items:center">
      <button class="btn small" id="calPrev">‹</button><b class="mono" id="calTitle" style="min-width:90px;text-align:center">${mLabel(mk)}</b><button class="btn small" id="calNext">›</button>
      <button class="btn small" id="calToday">Σήμερα</button>
      <button class="btn primary small" id="calNew" style="margin-left:auto">+ Ραντεβού</button>
    </div>
    <p style="color:var(--soft);font-size:12.5px;margin:-4px 0 12px">${gc === 'loading' ? 'Φόρτωση από το Google Calendar…' : gc === 'error' ? 'Σφάλμα ανάγνωσης — δοκιμάστε ανανέωση.' : gc === 'connect' ? 'Η σύνδεση Google χρειάζεται ανανέωση — ξανασυνδεθείτε από το tab «Λογαριασμός».' : 'Συνδεδεμένο με το Google Calendar σας' + (st.email ? ' (' + esc(st.email) + ')' : '') + ' · κλικ σε μέρα = νέο ραντεβού, κλικ σε ραντεβού = αλλαγή.'}</p>
    <div class="card" id="calGrid" style="overflow:hidden"><div class="calhead"><div>Δευ</div><div>Τρί</div><div>Τετ</div><div>Πέμ</div><div>Παρ</div><div>Σάβ</div><div>Κυρ</div></div><div class="calgrid">${cells}</div></div>
    <div class="card" id="calAgenda">${agenda}</div>`;
  document.getElementById('calPrev').onclick = () => { CAL.offset--; renderCal(); };
  document.getElementById('calNext').onclick = () => { CAL.offset++; renderCal(); };
  document.getElementById('calToday').onclick = () => { CAL.offset = 0; renderCal(); };
  document.getElementById('calNew').onclick = () => openCev(null, today);
}
document.getElementById('pBody').addEventListener('click', (e) => {
  if (pTab !== 'calendar') return;
  const g = e.target.closest('[data-gev]');
  if (g) { const ev = Object.values(CAL.cache).filter(Array.isArray).flat().find((x) => x.id === g.dataset.gev); if (ev) openCev(ev); return; }
  const day = e.target.closest('.calday:not(.dim)');
  if (day && !e.target.closest('.calev')) openCev(null, day.dataset.date);
});
/* ---- modal ραντεβού ---- */
let cevId = null;
const fillTimes = (sel, v) => { sel.innerHTML = '<option value="">—</option>' + TIMES.map((t) => `<option${t === v ? ' selected' : ''}>${t}</option>`).join(''); };
function openCev(ev, date) {
  cevId = ev ? ev.id : null;
  document.getElementById('cevTitle').textContent = ev ? 'Αλλαγή ραντεβού' : 'Νέο ραντεβού';
  document.getElementById('cev_title').value = ev ? ev.title : '';
  document.getElementById('cev_date').value = ev ? ev.date : (date || todayISO());
  fillTimes(document.getElementById('cev_start'), ev ? ev.start : '10:00'); fillTimes(document.getElementById('cev_end'), ev ? ev.end : '10:30');
  const phone = ev && /Τηλ:\s*(.+)/.exec(ev.desc || ''); document.getElementById('cev_phone').value = phone ? phone[1].trim() : '';
  document.getElementById('cev_desc').value = ev ? (ev.desc || '').replace(/Τηλ:.*\n?/, '').trim() : '';
  document.getElementById('cevDelete').hidden = !ev;
  document.getElementById('cevModal').hidden = false;
  document.getElementById('cev_title').focus();
}
document.getElementById('cevClose').onclick = () => { document.getElementById('cevModal').hidden = true; };
document.getElementById('cev_start').addEventListener('change', (e) => { const i = TIMES.indexOf(e.target.value); const end = document.getElementById('cev_end'); if (i >= 0 && (!end.value || end.value <= e.target.value)) end.value = TIMES[Math.min(i + 1, TIMES.length - 1)]; });
document.getElementById('cevSave').onclick = async () => {
  const title = document.getElementById('cev_title').value.trim(); if (!title) { alertBox('Γράψτε τίτλο.'); return; }
  const phone = document.getElementById('cev_phone').value.trim(); const notes = document.getElementById('cev_desc').value.trim();
  const ev = { title, date: document.getElementById('cev_date').value || todayISO(), start: document.getElementById('cev_start').value, end: document.getElementById('cev_end').value, desc: (phone ? 'Τηλ: ' + phone + '\n' : '') + notes };
  const b = document.getElementById('cevSave'); b.disabled = true;
  try {
    const cal = CAL.status.calendarId || 'primary';
    if (cevId) await gcal.patchEvent(CAL.status.clientId, cal, cevId, ev); else await gcal.createEvent(CAL.status.clientId, cal, ev);
    delete CAL.cache[ev.date.slice(0, 7)]; delete CAL.cache[calMonth()];
    document.getElementById('cevModal').hidden = true; alertBox(cevId ? 'Το ραντεβού ενημερώθηκε ✓' : 'Το ραντεβού προστέθηκε στο Google Calendar σας ✓'); renderCal();
  } catch (e) { alertBox(e.message); }
  b.disabled = false;
};
document.getElementById('cevDelete').onclick = async () => {
  const b = document.getElementById('cevDelete');
  if (b.textContent !== 'Σίγουρα;') { b.textContent = 'Σίγουρα;'; setTimeout(() => { b.textContent = 'Διαγραφή'; }, 2500); return; }
  b.disabled = true;
  try { await gcal.deleteEvent(CAL.status.clientId, CAL.status.calendarId || 'primary', cevId); CAL.cache = {}; document.getElementById('cevModal').hidden = true; alertBox('Το ραντεβού διαγράφηκε.'); renderCal(); }
  catch (e) { alertBox(e.message); }
  b.disabled = false; b.textContent = 'Διαγραφή';
};
async function renderAccount() {
  const st = await calStatus(); const el = document.getElementById('gcState'); const b = document.getElementById('gcDisconnect');
  el.textContent = st.error ? 'Μη διαθέσιμο αυτή τη στιγμή.' : st.connected ? `Συνδεδεμένο${st.email ? ' (' + st.email + ')' : ''} — τα ραντεβού σας φαίνονται στο tab «Ημερολόγιο».` : 'Δεν έχει συνδεθεί. Η σύνδεση γίνεται από το tab «Ημερολόγιο».';
  b.hidden = !st.connected;
  b.onclick = async () => {
    if (b.textContent !== 'Σίγουρα;') { b.textContent = 'Σίγουρα;'; setTimeout(() => { b.textContent = 'Αποσύνδεση Google'; }, 2500); return; }
    b.disabled = true;
    try { await callFunction('client-gcal-auth', { action: 'disconnect' }); gcal.dropTok(); CAL.status = null; CAL.cache = {}; alertBox('Το Google Calendar αποσυνδέθηκε.'); renderAccount(); }
    catch (e) { alertBox(e.message); }
    b.disabled = false; b.textContent = 'Αποσύνδεση Google';
  };
}
function renderRoot() {
  document.getElementById('pAccount').hidden = pTab !== 'account';
  document.getElementById('pBody').hidden = pTab === 'account';
  if (pTab === 'account') return renderAccount();
  if (pTab === 'appts') return renderAppts();
  if (pTab === 'journey') return renderJourney();
  if (pTab === 'bills') return renderBills();
  if (pTab === 'calendar') return renderCal();
  return render();
}
document.getElementById('pTabs').addEventListener('click', () => {}); // (κρατά τη σειρά των listeners)
load();

/* ---- Αλλαγή κωδικού ---- */
document.getElementById('pwSave').addEventListener('click', async () => {
  const a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
  const say = (m) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4200); };
  if (a.length < 10 || !/[A-Za-zΑ-Ωα-ω]/.test(a) || !/\d/.test(a)) { say('Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες, με γράμματα και αριθμούς.'); return; }
  if (a !== b) { say('Οι δύο κωδικοί δεν ταιριάζουν.'); return; }
  try { await updatePassword(a); document.getElementById('pw1').value = ''; document.getElementById('pw2').value = ''; say('Ο κωδικός άλλαξε ✓'); }
  catch (e) { say(e.message); }
});
