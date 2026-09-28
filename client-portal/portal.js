// portal/portal.js — προβολή στατιστικών ΜΟΝΟ της κλινικής του συνδεδεμένου πελάτη.
// Η βάση (RLS) εγγυάται ότι βλέπει αποκλειστικά τα δικά του monthly_stats & campaigns.
import { currentSession, sessionRole, logout } from '/app/shared/auth.js';
import { rest } from '/app/shared/supabase.js';
import { esc, eur, num, mLabel, nowMonth } from '/app/shared/util.js';

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
  let stats, camps, leads;
  try {
    [stats, camps, leads] = await Promise.all([
      rest('monthly_stats?select=*&order=month.desc&limit=24'),
      rest('campaigns?select=*&order=month.desc&limit=100'),
      rest('client_leads?select=*&order=created_time.desc&limit=500'),
    ]);
  } catch (e) {
    if (String(e.message).includes('session')) { location.href = '/login/'; return; }
    body.innerHTML = '<div class="card empty">Πρόβλημα φόρτωσης: ' + esc(e.message) + '</div>';
    return;
  }
  stats = stats.map(toCamel); camps = camps.map(toCamel);
  D = { stats, camps, leads: leads.map(toCamel) };
  const pend = D.leads.filter((l) => l.status === 'rv').length;
  const bd = document.getElementById('apptBadge');
  bd.textContent = pend; bd.style.display = pend ? '' : 'none';
  renderRoot();
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
    </div>`;

  const funnelHtml = `<h3 class="sectionhead">Η πορεία του μήνα</h3><div class="card section">${funnel(c)}</div>`;

  // Γράφημα 6 μηνών (παρελθόν + τρέχων)
  const last6 = [...past.slice(0, 5)].reverse().concat(cur ? [cur] : []);
  const chartHtml = last6.length >= 2 ? `<h3 class="sectionhead">Εξέλιξη</h3>
    <div class="card section"><div class="charthead"><h3>Ενδιαφερόμενοι & νέοι ασθενείς ανά μήνα</h3>
      <div class="legend"><span><i style="background:var(--c2)"></i>Ενδιαφερόμενοι</span><span><i style="background:var(--c3)"></i>Νέοι ασθενείς</span></div></div>
      <div style="padding:4px 10px 10px">${bars(last6.map((s) => mLabel(s.month)),
        [{ name: 'Ενδιαφερόμενοι', vals: last6.map((s) => +s.leads || 0), color: 'var(--c2)' },
         { name: 'Νέοι ασθενείς', vals: last6.map((s) => +s.sales || 0), color: 'var(--c3)' }], (v) => num(v))}</div></div>` : '';

  const hist = past.length ? `<h3 class="sectionhead">Ιστορικό ανά μήνα</h3>
    <div class="card tablewrap section"><table><thead><tr><th>Μήνας</th><th class="num">Ενδιαφ.</th><th class="num">Ραντεβού</th><th class="num">Ήρθαν</th><th class="num">Ασθενείς</th><th class="num">Έσοδα</th><th class="num">Δαπάνη</th><th class="num">€/Lead</th><th class="num">€/Ραντ.</th><th class="num">ROAS</th></tr></thead><tbody>
      ${past.map((s) => `<tr><td class="mono"><b>${mLabel(s.month)}</b></td><td class="num">${s.leads}</td><td class="num">${s.rv}</td><td class="num">${s.shows}</td><td class="num">${s.sales}</td><td class="num">${eur(s.revenue)}</td><td class="num">${eur(s.spend)}</td><td class="num">${s.cpl ? eur(s.cpl) : '—'}</td><td class="num">${s.rv && s.spend ? eur(s.spend / s.rv) : '—'}</td><td class="num">${s.spend > 0 ? (+s.roas).toFixed(2) + '×' : '—'}</td></tr>`).join('')}
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
  const today = new Date().toISOString().slice(0, 10);
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

function renderRoot() {
  if (pTab === 'appts') return renderAppts();
  if (pTab === 'journey') return renderJourney();
  return render();
}
document.getElementById('pTabs').addEventListener('click', () => {}); // (κρατά τη σειρά των listeners)
load();
