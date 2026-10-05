// dashboard/dashboard.js — Astra HQ: state, router, views.
import { CONFIG, VAPID_PUBLIC_KEY } from '/app/shared/config.js';
import { currentSession, logout, sessionRole } from '/app/shared/auth.js';
import { storageUpload, storageDownload, storageDelete, callFunction, updatePassword } from '/app/shared/supabase.js';
import * as data from '/app/shared/data.js';
import { sheetIdFrom, gidFrom, fetchSheetCSV, parseCSV, mapLeads } from '/app/shared/sheets.js';
import { spreadsheetIdFrom, writeToSheet, readSheetValues } from '/app/shared/gsheets.js';
import { uploadJsonToDrive, uploadReceipt, trashReceipt, RECEIPTS_FOLDER } from '/app/shared/gdrive.js';
import { sendEmail, welcomeEmail, billingEmail, reportEmail } from '/app/shared/gmail.js';
import { metaInsights } from '/app/shared/integrations.js';
import * as gcal from '/app/shared/gcal.js';
import {
  esc, eur, num, parseNum, todayISO, monthKey, nowMonth, mLabel, lastMonths,
  STATUS, CATS, uid, toast, quarterOf, addDays, downloadCSV,
} from '/app/shared/util.js';

/* ---- auth guard: η σελίδα μένει αόρατη μέχρι να επιβεβαιωθεί η σύνδεση ---- */
if (!currentSession()) location.replace('/login/');
else if (sessionRole().role === 'client') location.replace('/client-portal/');
else document.documentElement.classList.add('authed');

/* ============ state ============ */
const S = { clinics: [], leads: [], camps: [], fin: [], rec: [], act: [], tasks: [], cr: [], stats: [], trash: [], acct: [], clog: [], billing: [], subs: [], settings: null };
let activeTab = 'overview';
const $ = (id) => document.getElementById(id);
const clinicById = (id) => S.clinics.find((c) => c.id === id);
const COPY_ICON = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5"/><path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>';
const leadById = (id) => S.leads.find((l) => l.id === id);
const userEmail = () => { const s = currentSession(); return s ? s.email || '' : ''; };
const SET = () => S.settings || {};

let booted = false;
async function refresh() {
  try {
    const all = await data.loadAll();
    S.clinics = all.clinics; S.leads = all.leads; S.camps = all.campaigns; S.fin = all.finance;
    S.rec = all.recurring || []; S.act = all.activity || []; S.tasks = all.tasks || []; S.cr = all.creatives || [];
    S.stats = all.monthly_stats || []; S.trash = all.trash || []; S.acct = all.accountant || []; S.clog = all.client_log || []; S.billing = all.billing || []; S.subs = all.subscriptions || [];
    notifyRemoteLeads();
    S.settings = (all.settings && all.settings[0]) || null;
    $('dbBanner').hidden = true;
    applyRoles();
    updateTodayBadge();
    safeRender();
    if (!booted) { booted = true; onFirstLoad(); }
  } catch (e) {
    if (String(e.message).includes('session')) { location.href = '/login/'; return; }
    $('dbBanner').textContent = 'Πρόβλημα σύνδεσης με τη βάση: ' + e.message;
    $('dbBanner').hidden = false;
  }
}
async function onFirstLoad() {
  await materializeRecurring();
  await archiveMonthlyStats();
  purgeTrash();
  applyRetention();
  maybeDailyDigest();
  if (SET().autoSync !== false) autoSyncAll();
  maybeDailyMetaSync();
  maybeWeeklyDriveBackup();
  maybeMonthlyReportEmails();
  maybeMondayCharges();
}
/* Κάθε Δευτέρα (ή πρώτο άνοιγμα της εβδομάδας): κλείνει & χρεώνει την προηγούμενη εβδομάδα. */
async function maybeMondayCharges() {
  const s = SET();
  const w = lastWeeks(1)[0];
  if (s.lastAutoChargeWeek === w) return;
  try {
    await saveSetting({ lastAutoChargeWeek: w });
    /* Κάθε Δευτέρα: κλείνει η προηγούμενη εβδομάδα για όλες τις κλινικές (ο πελάτης βλέπει την οφειλή στο portal)·
       η αυτόματη χρέωση SEPA μόνο αν είναι ενεργή στις Ρυθμίσεις. */
    const r = s.autoCharge ? await runWeeklyCharges(w) : await closeWeekAll(w);
    if (r.closed || r.charged) toast(`Δευτέρα: έκλεισαν ${r.closed} εβδομαδιαίες εκκαθαρίσεις${s.autoCharge ? `, στάλθηκαν ${r.charged} χρεώσεις SEPA${r.failed ? ', ' + r.failed + ' αποτυχίες' : ''}` : ''}.`);
  } catch { /* επόμενο άνοιγμα */ }
}
/* 4) Ημερήσιο αυτόματο Meta sync */
async function maybeDailyMetaSync() {
  const s = SET();
  if (!s.metaToken) return;
  if (!s.metaAccount && !S.clinics.some((c) => c.metaAdAccount)) return;
  const today = todayISO();
  if (s.lastMetaSync === today) return;
  try {
    await saveSetting({ lastMetaSync: today });
    const r = await metaSyncAll(true);
    if (r.created || r.updated) toast(`Meta auto-sync: ${r.created} νέες, ${r.updated} ενημερωμένες καμπάνιες.`);
  } catch { /* αύριο πάλι */ }
}
/* 5) Εβδομαδιαίο backup στο Drive */
async function maybeWeeklyDriveBackup() {
  const s = SET();
  if (!gcalClient()) return;
  const now = new Date();
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const wk = 'w' + isoDate(monday);
  if (s.lastDriveBackup === wk) return;
  try {
    const all = await data.loadAll();
    await uploadJsonToDrive(gcalClient(), 'astra-backup-' + todayISO() + '.json', { exportedAt: new Date().toISOString(), ...all });
    await saveSetting({ lastDriveBackup: wk });
    toast('Εβδομαδιαίο backup ανέβηκε στο Drive ✓');
  } catch { /* π.χ. δεν έχει γίνει ακόμα σύνδεση Google — την επόμενη */ }
}
/* 3) Αυτόματο email αναφοράς προηγούμενου μήνα (αν ενεργοποιηθεί στις Ρυθμίσεις) */
async function maybeMonthlyReportEmails() {
  const s = SET();
  if (!s.autoReport) return;
  const pm = lastMonths(2)[0];
  if (s.lastReportSent === pm) return;
  const targets = S.clinics.filter((c) => (c.status || 'active') === 'active' && c.email);
  if (!targets.length) return;
  let sent = 0;
  for (const c of targets) {
    const st = computeStats(pm, c);
    if (!st.leads && !st.spend) continue;
    try {
      await sendEmail(gcalClient(), { to: c.email, ...reportEmail({ clinicName: c.name, monthLabel: mLabel(pm), s: st, fee: apptFee(), portalUrl: location.origin + '/client-portal/' }) });
      sent++;
    } catch { break; }
  }
  if (sent) { await saveSetting({ lastReportSent: pm }); toast(`Στάλθηκαν ${sent} μηνιαίες αναφορές (${mLabel(pm)}) στους πελάτες ✓`); }
}
async function saveSetting(patch) {
  try {
    if (S.settings) await data.update('settings', 'main', patch);
    else await data.create('settings', patch, 'main');
    Object.assign(S.settings = S.settings || {}, patch);
  } catch { /* δευτερεύον */ }
}
/* GDPR retention: ανωνυμοποίηση παλιών leads που δεν έγιναν πελάτες. */
async function applyRetention() {
  const months = +SET().retentionMonths || 0;
  if (!months) return;
  const cut = new Date(); cut.setMonth(cut.getMonth() - months);
  const targets = S.leads.filter((l) => !l.anonymized && l.status !== 'won' && l.createdTime && new Date(l.createdTime) < cut).slice(0, 50);
  if (!targets.length) return;
  for (const l of targets) {
    try { await data.update('leads', l.id, { name: 'Ανωνυμοποιημένο', phone: '', email: '', notes: '', sheetNotes: '', anonymized: true }); }
    catch { break; }
  }
  await refresh();
  toast(`GDPR: ανωνυμοποιήθηκαν ${targets.length} leads παλαιότερα των ${months} μηνών.`);
}

/* Πρωινό digest στη συσκευή — μία φορά την ημέρα, στο πρώτο άνοιγμα. */
function maybeDailyDigest() {
  if (!notifOn()) return;
  let last = null;
  try { last = localStorage.getItem('astra_digest'); } catch { return; }
  const today = todayISO();
  if (last === today) return;
  try { localStorage.setItem('astra_digest', today); } catch { /* ok */ }
  const { due, fresh, stale } = todayItems();
  const tdue = undoneTasksDue().length;
  const parts = [];
  if (due.length) parts.push(due.length + ' ενέργειες για σήμερα');
  if (fresh.length) parts.push(fresh.length + ' νέα leads χωρίς επικοινωνία');
  if (tdue) parts.push(tdue + ' tasks');
  if (stale.length) parts.push(stale.length + ' ξεχασμένα');
  if (subsDue().length) parts.push(subsDue().length + ' ετήσιες συνδρομές προς ανανέωση');
  if (parts.length) browserNotify('Καλημέρα! Η μέρα σου:', parts.join(' · '));
}

/* ---- rail foot ---- */
const badge = $('backendBadge');
if (CONFIG.backend === 'supabase') {
  badge.textContent = 'cloud'; badge.className = 'badge-backend cloud';
  $('whoami').textContent = userEmail();
} else {
  badge.textContent = 'local'; badge.className = 'badge-backend local';
  $('whoami').textContent = userEmail() + ' · δεδομένα σε αυτόν τον browser';
}
$('btnLogout').hidden = false;
$('btnLogout').onclick = () => { logout(); location.href = '/login/'; };

/* ============ roles (UI-level) ============ */
const CALLER_TABS = ['today', 'tasks', 'calendar', 'leads'];
function isCaller() {
  if (CONFIG.backend !== 'supabase') return false;
  const list = String(SET().callerEmails || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(userEmail().toLowerCase());
}
function applyRoles() {
  const caller = isCaller();
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.hidden = caller && !CALLER_TABS.includes(b.dataset.tab);
  });
  if (caller && !CALLER_TABS.includes(activeTab)) showTab('today');
}

/* ============ tabs ============ */
const TABS = ['today', 'tasks', 'calendar', 'overview', 'clinics', 'leads', 'campaigns', 'finance', 'reports', 'settings'];
const TAB_LABELS = { today: 'Σήμερα', tasks: 'Tasks', calendar: 'Ημερολόγιο', overview: 'Επισκόπηση', clinics: 'Κλινικές', leads: 'Leads', campaigns: 'Campaigns', finance: 'Οικονομικά', reports: 'Αναφορές', settings: 'Ρυθμίσεις' };
function showTab(t) {
  activeTab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  TABS.forEach((x) => { $('tab-' + x).hidden = x !== t; });
  $('tab-clinic').hidden = true;
  document.querySelectorAll('#mtabbar button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('mtopTitle').textContent = TAB_LABELS[t] || 'Astra HQ';
  window.scrollTo({ top: 0 });
  try { localStorage.setItem('astra-tab', t); } catch { /* storage blocked */ }
  if (history.replaceState) history.replaceState(null, '', '#' + t);
  renderAll();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
/* Καλείται στο τέλος του module (αφού οριστούν όλα τα helpers), αλλιώς TDZ σφάλμα στο φόρτωμα. */
function initTab() {
  let t = (location.hash || '').replace('#', '');
  if (!TABS.includes(t)) { try { t = localStorage.getItem('astra-tab') || ''; } catch { t = ''; } }
  /* Κινητό: το app ανοίγει πάντα στο «Σήμερα» (πρόγραμμα ημέρας + tasks), εκτός αν το link ζητά άλλο tab. */
  if (!(location.hash || '').replace('#', '') && window.matchMedia && window.matchMedia('(max-width: 900px)').matches) t = 'today';
  if (TABS.includes(t)) showTab(t);
}

/* ============ deferred render ============ */
let renderPending = false;
function safeRender() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.closest('#leadTable,#finTable,#campTable,#recTable,#leadModal,#tab-settings,#clinicView')) {
    renderPending = true;
    ae.addEventListener('blur', () => { if (renderPending) { renderPending = false; renderAll(); } }, { once: true });
    return;
  }
  renderAll();
}

/* ============ activity log ============ */
/* ---- κάδος: κάθε διαγραφή κρατά αντίγραφο 30 ημερών ---- */
const COLL_LABEL = { clinics: 'Κλινική', leads: 'Lead', campaigns: 'Καμπάνια', finance: 'Εγγραφή', recurring: 'Πάγια', subscriptions: 'Συνδρομή', creatives: 'Δημιουργικό', tasks: 'Task' };
function collSource(coll) { return { clinics: S.clinics, leads: S.leads, campaigns: S.camps, finance: S.fin, recurring: S.rec, subscriptions: S.subs, creatives: S.cr, tasks: S.tasks }[coll]; }
async function trashRemove(coll, id) {
  const src = collSource(coll);
  const row = src && src.find((r) => r.id === id);
  if (row) {
    const { id: _drop, ...body } = row;
    try { await data.create('trash', { coll, docId: id, body, by: userEmail(), deletedAt: new Date().toISOString() }, 'tr' + uid()); }
    catch { /* ο κάδος δεν μπλοκάρει τη διαγραφή */ }
  }
  await data.remove(coll, id);
}
async function purgeTrash() {
  const cut = Date.now() - 30 * 24 * 3600 * 1000;
  for (const t of (S.trash || []).filter((x) => new Date(x.deletedAt).getTime() < cut)) {
    try { await data.remove('trash', t.id); } catch { /* επόμενη φορά */ }
  }
}
function downloadJSON(filename, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function logAct(leadId, type, body) {
  try { await data.create('activity', { leadId, at: new Date().toISOString(), type, by: userEmail(), body }, 'a' + uid()); }
  catch { /* το ιστορικό δεν μπλοκάρει τη δουλειά */ }
}
async function updateLead(id, patch, logType, logBody) {
  await data.update('leads', id, patch);
  if (logType) await logAct(id, logType, logBody || '');
  await refresh();
}

/* ============ Google Sheet / CSV import ============ */
async function importRows(rows, clinic, label) {
  let leads;
  try { leads = mapLeads(rows, clinic.id); }
  catch (e) { toast(e.message); return 0; }
  if (!leads.length) { toast('Δεν βρέθηκαν leads στο ' + label + '.'); return 0; }
  let added = 0;
  try {
    const before = new Set(S.leads.map((l) => l.id));
    const fresh = leads.filter((l) => !before.has(l.id));
    added = await data.upsertLeads(leads);
    for (const l of fresh.slice(0, added)) await logAct(l.id, 'import', 'Ήρθε από ' + label + ' (' + (l.campaign || 'χωρίς καμπάνια') + ')');
  } catch (e) { toast('Η εισαγωγή απέτυχε: ' + e.message); return 0; }
  try { await data.update('clinics', clinic.id, { lastSync: new Date().toISOString() }); } catch { /* δευτερεύον */ }
  suppressNotif = true;
  await refresh();
  suppressNotif = false;
  if (added > 0) notifyNewLeads(clinic, added);
  return added;
}
function notifyNewLeads(clinic, n) {
  browserNotify(`${n} νέο${n > 1 ? 'ι' : ''} lead${n > 1 ? 's' : ''} — ${clinic.name}`, 'Άνοιξε το tab «Σήμερα» για follow-up.');
  pushSub().then((sub) => callFunction('push-send', { action: 'leads', clinic: clinic.name, n, endpoint: sub ? sub.endpoint : '' })).catch(() => { /* push προαιρετικό */ });
}

/* ---- push ειδοποιήσεις (Web Push μέσω service worker — έρχονται και με το app κλειστό) ---- */
/* Scope '/' θέλει header Service-Worker-Allowed που ο host δεν στέλνει — τότε πέφτει στο προεπιλεγμένο scope /app/ (αρκεί για push). */
const swReg = navigator.serviceWorker
  ? navigator.serviceWorker.register('/app/sw.js', { scope: '/' }).catch(() => navigator.serviceWorker.register('/app/sw.js')).catch(() => null)
  : Promise.resolve(null);
/* Δεύτερος worker στη ρίζα (/sw.js, scope /): φρέσκο HTML/JS σε κάθε άνοιγμα, και offline fallback. */
if (navigator.serviceWorker) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ---- νέα έκδοση: το PWA στο κινητό μένει «ζωντανό» στη μνήμη και δεν ξαναφορτώνει μόνο του.
   Ελέγχουμε το ETag του dashboard.js όταν το app έρχεται μπροστά (και κάθε 5′)· αν άλλαξε → reload. ---- */
let bootEtag = null;
async function versionEtag() {
  try { const r = await fetch('/portal/dashboard.js', { method: 'HEAD', cache: 'no-store' }); return r.ok ? (r.headers.get('etag') || r.headers.get('last-modified') || '') : null; }
  catch { return null; }
}
async function checkVersion(auto) {
  const et = await versionEtag();
  if (et === null) return;
  if (bootEtag === null) { bootEtag = et; return; }
  if (et === bootEtag) return;
  const modalOpen = [...document.querySelectorAll('.modalback')].some((m) => !m.hidden);
  if (auto && !modalOpen) { reloadApp(); return; }
  const b = $('dbBanner'); b.innerHTML = 'Υπάρχει νέα έκδοση του Astra HQ — <button class="btn small primary" id="btnReloadApp">Ανανέωση</button>'; b.hidden = false;
  $('btnReloadApp').onclick = reloadApp;
}
function reloadApp() { location.replace('/portal/?v=' + Date.now() + (location.hash || '')); }
checkVersion(false);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkVersion(true); refresh(); } });
setInterval(() => checkVersion(false), 5 * 60_000);
const pushSupported = () => CONFIG.backend === 'supabase' && !!VAPID_PUBLIC_KEY && !!navigator.serviceWorker && 'PushManager' in window && typeof Notification !== 'undefined';
async function pushSub() {
  if (!pushSupported()) return null;
  const reg = await swReg;
  return reg ? reg.pushManager.getSubscription() : null;
}
function swActive(reg) {
  if (reg.active) return Promise.resolve();
  const w = reg.installing || reg.waiting;
  if (!w) return Promise.resolve();
  return new Promise((res) => w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') res(); }));
}
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function renderPush() {
  const st = $('pushState');
  if (!pushSupported()) {
    $('btnPushOn').hidden = true; $('btnPushTest').hidden = true; $('btnPushOff').hidden = true;
    st.textContent = CONFIG.backend !== 'supabase' ? 'Διαθέσιμο μόνο σε cloud mode.'
      : !VAPID_PUBLIC_KEY ? 'Δεν έχει ολοκληρωθεί ακόμα η ρύθμιση στον server.'
      : 'Αυτή η συσκευή δεν το υποστηρίζει έτσι όπως είναι ανοιχτό το app. Στο iPhone: Κοινή χρήση → «Προσθήκη στην οθόνη Αφετηρίας» και άνοιξέ το από το εικονίδιο.';
    return;
  }
  const sub = await pushSub().catch(() => null);
  $('btnPushOn').hidden = !!sub; $('btnPushTest').hidden = !sub; $('btnPushOff').hidden = !sub;
  st.textContent = sub ? 'Ενεργές σε αυτή τη συσκευή ✓' : Notification.permission === 'denied' ? 'Οι ειδοποιήσεις είναι μπλοκαρισμένες στις ρυθμίσεις της συσκευής για αυτό το app.' : 'Ανενεργές σε αυτή τη συσκευή.';
}
$('btnPushOn').onclick = async () => {
  const b = $('btnPushOn'); b.disabled = true;
  try {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Δεν δόθηκε άδεια για ειδοποιήσεις.');
    const reg = await swReg;
    if (!reg) throw new Error('Ο service worker δεν φόρτωσε — ανανέωσε τη σελίδα.');
    /* ΟΧΙ navigator.serviceWorker.ready: περιμένει worker που ελέγχει ΑΥΤΗ τη σελίδα (/portal/), ενώ ο δικός μας έχει scope /app/ — δεν θα έλυνε ποτέ. */
    await withTimeout(swActive(reg), 20000, 'Ο service worker δεν ενεργοποιήθηκε — κλείσε και ξανάνοιξε το app.');
    const sub = (await reg.pushManager.getSubscription())
      || (await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlBytes(VAPID_PUBLIC_KEY) }), 20000, 'Η εγγραφή για push δεν απάντησε — δοκίμασε ξανά με καλύτερο δίκτυο.'));
    await callFunction('push-send', { action: 'subscribe', sub: sub.toJSON(), ua: navigator.userAgent });
    await callFunction('push-send', { action: 'test', endpoint: sub.endpoint });
    toast('Ειδοποιήσεις push ενεργές ✓ — στάλθηκε δοκιμαστική.');
  } catch (e) { toast(e.message); }
  b.disabled = false; renderPush();
};
$('btnPushTest').onclick = async () => {
  try {
    const sub = await pushSub();
    const j = await callFunction('push-send', { action: 'test', endpoint: sub ? sub.endpoint : '' });
    toast(j.sent ? 'Στάλθηκε — θα εμφανιστεί σε λίγα δευτερόλεπτα.' : 'Η συσκευή δεν βρέθηκε στον server — απενεργοποίησε και ξαναενεργοποίησε.');
  } catch (e) { toast(e.message); }
};
$('btnPushOff').onclick = async () => {
  try {
    const sub = await pushSub();
    if (sub) { await callFunction('push-send', { action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    toast('Οι ειδοποιήσεις push απενεργοποιήθηκαν σε αυτή τη συσκευή.');
  } catch (e) { toast(e.message); }
  renderPush();
};

/* ---- browser notifications (ανά συσκευή) ---- */
const notifOn = () => { try { return localStorage.getItem('astra_notif') === '1' && Notification.permission === 'granted'; } catch { return false; } };
function browserNotify(title, body) {
  if (!notifOn()) return;
  try { new Notification('Astra HQ · ' + title, { body, icon: '/app/assets/icon-192.png' }); } catch { /* not supported */ }
}
/* Ειδοποίηση και για leads που έφερε άλλη συσκευή/συνάδελφος (φαίνονται στο refresh). */
let knownLeadIds = null;
let suppressNotif = false; // όταν το import γίνεται από αυτή τη συσκευή, ειδοποιεί το notifyNewLeads, όχι το diff
function notifyRemoteLeads() {
  const ids = new Set(S.leads.map((l) => l.id));
  if (knownLeadIds && !suppressNotif && notifOn()) {
    const fresh = S.leads.filter((l) => !knownLeadIds.has(l.id));
    if (fresh.length && fresh.length <= 5) {
      fresh.forEach((l) => { const c = clinicById(l.clinicId); browserNotify('Νέο lead: ' + l.name, (c ? c.name : '') + (l.campaign ? ' · ' + l.campaign : '')); });
    } else if (fresh.length > 5) {
      browserNotify(fresh.length + ' νέα leads', 'Μπήκαν από συγχρονισμό.');
    }
  }
  knownLeadIds = ids;
}
async function syncClinic(clinic, silent) {
  if (!clinic.sheetId) { if (!silent) toast('Η κλινική δεν έχει Google Sheet link.'); return 0; }
  // Πρώτα ιδιωτική ανάγνωση μέσω Sheets API (δεν χρειάζεται «Anyone with link»)
  if (gcalClient()) {
    try {
      const rows = await readSheetValues(gcalClient(), clinic.sheetId);
      return importRows(rows, clinic, 'sheet');
    } catch (e) {
      if (e.code !== 'connect_needed' && !silent) toast(e.message);
      if (e.code !== 'connect_needed') return 0;
      // χωρίς σύνδεση Google ακόμα → δοκίμασε το δημόσιο CSV
    }
  }
  let csv;
  try { csv = await fetchSheetCSV(clinic.sheetId, gidFrom(clinic.sheetUrl)); }
  catch (e) { if (!silent) toast(e.message); return 0; }
  return importRows(parseCSV(csv), clinic, 'sheet');
}
async function autoSyncAll() {
  const cut = Date.now() - 30 * 60 * 1000;
  const due = S.clinics.filter((c) => c.sheetId && (!c.lastSync || new Date(c.lastSync).getTime() < cut));
  if (!due.length) return;
  let tot = 0;
  for (const c of due) tot += await syncClinic(c, true);
  if (tot) toast(`Auto-sync: μπήκαν ${tot} νέα leads.`);
}

/* CSV upload fallback ανά κλινική */
let csvClinicId = null;
$('csvFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  const clinic = clinicById(csvClinicId); csvClinicId = null;
  if (!file || !clinic) return;
  const text = await file.text();
  const n = await importRows(parseCSV(text), clinic, 'αρχείο');
  if (n >= 0) toast(n ? `Μπήκαν ${n} νέα leads από το CSV.` : 'Κανένα νέο lead στο CSV.');
});

/* ============ TASKS ============ */
const taskOwners = () => String(SET().taskOwners || 'Apo,Marga').split(',').map((s) => s.trim()).filter(Boolean);
const undoneTasksDue = () => S.tasks.filter((t) => !t.done && t.date <= todayISO());
function taskRow(t) {
  const today = todayISO();
  const over = !t.done && t.date < today;
  const dstr = t.date === today ? '' : new Date(t.date).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
  return `<div class="taskrow ${t.done ? 'done' : ''} ${over ? 'over' : ''}" data-task="${t.id}">
    <input type="checkbox" data-tact="toggle"${t.done ? ' checked' : ''} aria-label="Ολοκληρώθηκε">
    <div class="tt">${esc(t.title)}${(over || dstr) ? `<div class="tm">${over ? 'από ' + new Date(t.date).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : dstr}</div>` : ''}</div>
    <button class="del" data-tact="del" title="Διαγραφή">✕</button>
  </div>`;
}
function renderTasks() {
  const today = todayISO(), tomorrow = addDays(1);
  $('taskCols').innerHTML = taskOwners().map((owner) => {
    const mine = S.tasks.filter((t) => t.owner === owner);
    const undone = mine.filter((t) => !t.done).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const groups = [
      ['Εκκρεμή / Σήμερα', undone.filter((t) => t.date <= today)],
      ['Αύριο', undone.filter((t) => t.date === tomorrow)],
      ['Επόμενα', undone.filter((t) => t.date > tomorrow)],
    ];
    const doneRecent = mine.filter((t) => t.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''))).slice(0, 8);
    const body = groups.map(([lb, arr]) => arr.length ? `<div class="taskday">${lb}</div>` + arr.map(taskRow).join('') : '').join('')
      + (doneRecent.length ? `<div class="taskday">Ολοκληρωμένα</div>` + doneRecent.map(taskRow).join('') : '');
    return `<div class="taskcol" data-owner="${esc(owner)}">
      <h3>${esc(owner)} <span class="chip ${undone.length ? 'epik' : 'plain'}">${undone.length} εκκρεμή</span></h3>
      <div class="card">
        ${body || '<div class="empty">Κανένα task. Γράψε τα αυριανά από κάτω.</div>'}
        <div class="taskadd">
          <input type="text" data-tact="title" placeholder="Τι πρέπει να γίνει…" id="ta_${esc(owner)}">
          <input type="date" data-tact="date" value="${tomorrow}" id="td_${esc(owner)}">
          <button class="btn small primary" data-tact="add">+ Προσθήκη</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
async function addTask(owner, title, date) {
  if (!title.trim()) { toast('Γράψε τι πρέπει να γίνει.'); return false; }
  try {
    await data.create('tasks', {
      owner, title: title.trim(), date: date || addDays(1), done: false, doneAt: null,
      createdAt: new Date().toISOString(), createdBy: userEmail(),
    }, 't' + uid());
    await refresh();
    return true;
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return false; }
}
async function handleTaskAction(e) {
  const el = e.target.closest('[data-tact]'); if (!el) return false;
  const tact = el.dataset.tact;
  if (tact === 'add') {
    const col = el.closest('.taskcol'); const owner = col.dataset.owner;
    const ti = col.querySelector('[data-tact=title]'), di = col.querySelector('[data-tact=date]');
    if (await addTask(owner, ti.value, di.value)) { ti.value = ''; ti.focus(); }
    return true;
  }
  const row = el.closest('[data-task]'); if (!row) return false;
  const id = row.dataset.task; const t = S.tasks.find((x) => x.id === id); if (!t) return false;
  if (tact === 'toggle') {
    try { await data.update('tasks', id, { done: !t.done, doneAt: !t.done ? new Date().toISOString() : null }); await refresh(); }
    catch (err) { toast('Αποτυχία: ' + err.message); }
    return true;
  }
  if (tact === 'del') {
    if (el.textContent !== 'Σίγουρα;') { el.textContent = 'Σίγουρα;'; setTimeout(() => { el.textContent = '✕'; }, 2500); return true; }
    try { await trashRemove('tasks', id); await refresh(); } catch (err) { toast('Αποτυχία: ' + err.message); }
    return true;
  }
  return false;
}
$('taskCols').addEventListener('click', handleTaskAction);
$('taskCols').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.tact === 'title') {
    e.target.closest('.taskcol').querySelector('[data-tact=add]').click();
  }
});

/* ============ TODAY ============ */
function todayItems() {
  const today = todayISO();
  const cutoff48 = Date.now() - 48 * 3600 * 1000;
  const open = S.leads.filter((l) => !['won', 'lost'].includes(l.status));
  const due = open.filter((l) => l.nextAction && l.nextAction <= today)
    .sort((a, b) => String(a.nextAction).localeCompare(String(b.nextAction)));
  const fresh = open.filter((l) => l.status === 'neo' && !l.nextAction && new Date(l.createdTime).getTime() < cutoff48)
    .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  const upcoming = open.filter((l) => l.status === 'rv' && l.nextAction && l.nextAction > today)
    .sort((a, b) => String(a.nextAction).localeCompare(String(b.nextAction)));
  const cutoff21 = Date.now() - 21 * 24 * 3600 * 1000;
  const lastTouch = (l) => {
    const acts = S.act.filter((a) => a.leadId === l.id).map((a) => new Date(a.at).getTime());
    return Math.max(new Date(l.importedAt || l.createdTime || 0).getTime(), ...(acts.length ? acts : [0]));
  };
  const stale = open.filter((l) => ['epik', 'rv', 'show'].includes(l.status) && (!l.nextAction || l.nextAction < today) && lastTouch(l) < cutoff21)
    .sort((a, b) => lastTouch(a) - lastTouch(b));
  return { due, fresh, upcoming, stale };
}
function updateTodayBadge() {
  const { due, fresh } = todayItems();
  const n = due.length + fresh.length + undoneTasksDue().length;
  const el = $('todayCount');
  el.textContent = n; el.style.display = n ? '' : 'none';
  const mb = $('mtabBadge');
  if (mb) { mb.textContent = n > 99 ? '99+' : n; mb.hidden = !n; }
}
function todayRow(l, kind) {
  const c = clinicById(l.clinicId);
  const today = todayISO();
  const over = l.nextAction && l.nextAction < today;
  const dueTxt = kind === 'fresh'
    ? 'χωρίς επικοινωνία από ' + new Date(l.createdTime).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })
    : (l.status === 'rv' ? 'ραντεβού ' : 'ενέργεια ') + new Date(l.nextAction).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
  return `<div class="todayrow" data-id="${l.id}">
    <div class="who"><b data-act="open">${esc(l.name)}</b><div class="sub">${esc(c ? c.name : '—')}${l.campaign ? ' · ' + esc(l.campaign) : ''}</div></div>
    <span class="chip ${l.status}">${STATUS[l.status]}</span>
    <span class="due ${over ? 'over' : ''}">${dueTxt}</span>
    <span class="mono" style="font-size:12.5px">${esc(l.phone || '')}${l.phone ? `<button class="copybtn" data-copy="${esc(l.phone)}" title="Αντιγραφή">${COPY_ICON}</button>` : ''}</span>
    <div class="acts">
      ${kind === 'fresh' ? '<button class="btn small" data-act="called">Κλήθηκε</button>' : ''}
      <button class="btn small" data-act="p1">+1μ</button>
      <button class="btn small" data-act="p3">+3μ</button>
      <button class="btn small" data-act="p7">+7μ</button>
      ${kind !== 'fresh' ? '<button class="btn small" data-act="done">✓ Έγινε</button>' : ''}
    </div>
  </div>`;
}
/* Πρόγραμμα ημέρας: τα συμβάντα του Google Calendar για σήμερα και αύριο. */
function scheduleBlock() {
  if (!gcalKey() && !gcalClient()) return '';
  const today = todayISO(), tomorrow = addDays(1);
  const months = [...new Set([monthKey(today), monthKey(tomorrow)])];
  months.forEach(loadGcalMonth);
  const states = months.map((m) => gcalCache[m]);
  const evs = states.filter(Array.isArray).flat();
  const byTime = (a, b) => String(a.start).localeCompare(String(b.start));
  const row = (ev) => `<button class="agrow" data-gev="${esc(ev.id)}"><span class="mono">${ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : 'όλη μέρα'}</span><span>${esc(ev.title)}</span></button>`;
  const td = evs.filter((e) => e.date === today).sort(byTime), tm = evs.filter((e) => e.date === tomorrow).sort(byTime);
  const body = states.includes('loading') && !evs.length ? '<div class="empty" style="padding:14px">Φόρτωση προγράμματος…</div>'
    : states.some((x) => x === 'connect' || x === 'error') && !evs.length ? '<div class="empty" style="padding:14px">Το Google Calendar δεν είναι διαθέσιμο — άνοιξε το tab «Ημερολόγιο».</div>'
    : (td.length ? td.map(row).join('') : '<div class="empty" style="padding:14px">Κανένα ραντεβού σήμερα ✓</div>')
      + (tm.length ? `<div class="taskday">Αύριο</div>${tm.map(row).join('')}` : '');
  return `<h3 class="sectionhead" style="margin-top:0">Πρόγραμμα ημέρας <span class="chip ${td.length ? 'epik' : 'plain'}">${td.length} σήμερα</span>
      <button class="btn small" data-newev style="margin-left:auto">+ Συμβάν</button></h3>
    <div class="card" style="margin-bottom:20px">${body}</div>`;
}
function renderToday() {
  const { due, fresh, upcoming, stale } = todayItems();
  const sec = (title, chip, arr, kind, emptyTxt) =>
    `<h3 class="sectionhead">${title} <span class="chip ${chip}">${arr.length}</span></h3>
     <div class="card">${arr.length ? arr.map((l) => todayRow(l, kind)).join('') : `<div class="empty">${emptyTxt}</div>`}</div>`;
  const touches = S.clinics.filter((c) => c.nextTouch && c.nextTouch <= todayISO() && (c.status || 'active') !== 'ended')
    .sort((a, b) => String(a.nextTouch).localeCompare(String(b.nextTouch)));
  const touchBlock = touches.length ? `<h3 class="sectionhead" style="margin-top:0">Πελάτες — επόμενη επαφή <span class="chip epik">${touches.length}</span></h3>
    <div class="card" style="margin-bottom:20px">${touches.map((c) => `<div class="todayrow" data-clinic="${c.id}">
      <div class="who"><b data-tact2="openclinic">${esc(c.name)}</b><div class="sub">${esc(c.phone || '')}</div></div>
      <span class="due ${c.nextTouch < todayISO() ? 'over' : ''}">${new Date(c.nextTouch).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</span>
      <div class="acts">
        <button class="btn small" data-tact2="t7">+7μ</button>
        <button class="btn small" data-tact2="t30">+30μ</button>
        <button class="btn small" data-tact2="tdone">✓ Έγινε</button>
      </div></div>`).join('')}</div>` : '';
  const subs = isCaller() ? [] : subsDue();
  const subBlock = subs.length ? `<h3 class="sectionhead" style="margin-top:0">Ετήσιες συνδρομές — ανανέωση <span class="chip epik">${subs.length}</span></h3>
    <div class="card" style="margin-bottom:20px">${subs.map((s) => `<div class="todayrow" data-sub="${s.id}">
      <div class="who"><b data-tact3="opensubs">${esc(subName(s))}</b><div class="sub">${esc(s.description || '')}${+s.net ? ' · ' + eur(+s.net) + ' + ΦΠΑ' : ''}</div></div>
      <span class="due ${subDays(s) < 0 ? 'over' : ''}">${subWhen(s)}</span>
      <div class="acts"><button class="btn small" data-tact3="renew">✓ Ανανεώθηκε</button></div></div>`).join('')}</div>` : '';
  const tdue = undoneTasksDue();
  const tnext = S.tasks.filter((t) => !t.done && t.date > todayISO()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const taskBlock = `<h3 class="sectionhead">Tasks <span class="chip ${tdue.length ? 'epik' : 'plain'}">${tdue.length} για σήμερα</span>${tnext.length ? ` <span class="chip plain">${tnext.length} επόμενα</span>` : ''}</h3>
    <div class="taskcols">${taskOwners().map((o) => {
      const mine = tdue.filter((t) => t.owner === o).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const later = tnext.filter((t) => t.owner === o);
      return `<div class="taskcol"><h3>${esc(o)}</h3><div class="card">`
        + (mine.length ? mine.map(taskRow).join('') : '<div class="empty" style="padding:14px">Τίποτα για σήμερα ✓</div>')
        + (later.length ? `<div class="taskday">Επόμενα</div>${later.map(taskRow).join('')}` : '')
        + '</div></div>';
    }).join('')}</div>`;
  $('todayBody').innerHTML = scheduleBlock() + taskBlock + '<div style="height:20px"></div>' + touchBlock + subBlock + clinicCallsBlock(due, fresh, upcoming, stale);
}
/* Κλήσεις ημέρας ομαδοποιημένες ανά κλινική — κλειστές κάρτες με σύνοψη, ανοίγουν με κλικ. */
let openCallGroups = new Set();
try { openCallGroups = new Set(JSON.parse(localStorage.getItem('astra-today-open') || '[]')); } catch { /* ok */ }
function clinicCallsBlock(due, fresh, upcoming, stale) {
  const groups = new Map();
  const add = (l, kind) => {
    const k = l.clinicId || '_none';
    if (!groups.has(k)) groups.set(k, { due: [], fresh: [], up: [], stale: [] });
    groups.get(k)[kind].push(l);
  };
  due.forEach((l) => add(l, 'due'));
  fresh.forEach((l) => add(l, 'fresh'));
  upcoming.forEach((l) => add(l, 'up'));
  stale.forEach((l) => add(l, 'stale'));
  if (!groups.size) return `<h3 class="sectionhead">Κλήσεις ανά κλινική</h3><div class="card"><div class="empty">Καμία κλήση για σήμερα. 🎉</div></div>`;
  const rows = [...groups.entries()].map(([cid, g]) => {
    const calls = g.due.length + g.fresh.length + g.stale.length;
    return { cid, g, calls, c: clinicById(cid) };
  }).sort((a, b) => b.calls - a.calls || b.g.up.length - a.g.up.length);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const staleRow = (l) => `<div class="todayrow" data-id="${l.id}">
      <div class="who"><b data-act="open">${esc(l.name)}</b><div class="sub">${esc(l.phone || '')}</div></div>
      <span class="chip ${l.status}">${STATUS[l.status]}</span>
      <div class="acts">
        <button class="btn small" data-act="p3">Ξαναπάρε +3μ</button>
        <button class="btn small danger" data-act="marklost">Κλείσε ως χαμένο</button>
      </div></div>`;
  const sub = (title, chip, arr, render) => arr.length
    ? `<div class="taskday" style="display:flex;gap:6px;align-items:center">${title} <span class="chip ${chip}" style="font-size:10px">${arr.length}</span></div>${arr.map(render).join('')}` : '';
  return `<h3 class="sectionhead">Κλήσεις ανά κλινική <span class="chip ${totalCalls ? 'epik' : 'plain'}">${totalCalls} τηλέφωνα</span></h3>
    <div class="callgroups">${rows.map(({ cid, g, calls, c }) => {
      const open = openCallGroups.has(cid);
      const parts = [];
      if (g.due.length) parts.push(`<span class="chip lost">${g.due.length} για σήμερα</span>`);
      if (g.fresh.length) parts.push(`<span class="chip epik">${g.fresh.length} νέα</span>`);
      if (g.stale.length) parts.push(`<span class="chip plain">${g.stale.length} ξεχασμένα</span>`);
      if (g.up.length) parts.push(`<span class="chip rv">${g.up.length} ραντεβού</span>`);
      return `<div class="card callgroup${open ? ' open' : ''}">
        <button class="cghead" data-cgrp="${cid}" aria-expanded="${open}">
          <span class="cgchev">${open ? '▾' : '▸'}</span>
          <b>${esc(c ? c.name : 'Χωρίς κλινική')}</b>
          <span class="cgcount">${calls} τηλέφωνα</span>
          <span class="cgchips">${parts.join('')}</span>
        </button>
        ${open ? `<div class="cgbody">
          ${sub('Για σήμερα', 'lost', g.due, (l) => todayRow(l, 'due'))}
          ${sub('Νέα χωρίς επικοινωνία (48ω+)', 'epik', g.fresh, (l) => todayRow(l, 'fresh'))}
          ${sub('Ξεχασμένα · 21+ μέρες', 'plain', g.stale, staleRow)}
          ${sub('Επερχόμενα ραντεβού', 'rv', g.up.slice(0, 15), (l) => todayRow(l, 'up'))}
        </div>` : ''}
      </div>`;
    }).join('')}</div>`;
}
$('btnTodayRefresh').onclick = refresh;
$('todayBody').addEventListener('click', async (e) => {
  const tg = e.target.closest('[data-cgrp]');
  if (tg) {
    const k = tg.dataset.cgrp;
    if (openCallGroups.has(k)) openCallGroups.delete(k); else openCallGroups.add(k);
    try { localStorage.setItem('astra-today-open', JSON.stringify([...openCallGroups])); } catch { /* ok */ }
    renderToday();
    return;
  }
  const gev = e.target.closest('[data-gev]');
  if (gev) { openGev(gev.dataset.gev); return; }
  if (e.target.closest('[data-newev]')) { openEventModal(null, todayISO()); return; }
  const t3 = e.target.closest('[data-tact3]');
  if (t3) {
    if (t3.dataset.tact3 === 'opensubs') { showTab('finance'); $('subTable').scrollIntoView({ block: 'center' }); return; }
    t3.disabled = true;
    await renewSub(t3.closest('[data-sub]').dataset.sub);
    return;
  }
  const t2 = e.target.closest('[data-tact2]');
  if (t2) {
    const row = t2.closest('[data-clinic]'); const cid = row && row.dataset.clinic;
    const c = clinicById(cid); if (!c) return;
    const act2 = t2.dataset.tact2;
    if (act2 === 'openclinic') { showClinic(cid, 'crm'); return; }
    const v = act2 === 't7' ? addDays(7) : act2 === 't30' ? addDays(30) : null;
    try {
      await data.update('clinics', cid, { nextTouch: v });
      await addClientLog(cid, 'note', v ? 'Επόμενη επαφή μετατέθηκε για ' + v : 'Η επαφή ολοκληρώθηκε');
      await refresh();
    } catch (err) { toast('Αποτυχία: ' + err.message); }
    return;
  }
  if (e.target.closest('[data-tact]')) { handleTaskAction(e); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = b.closest('.todayrow'); if (!row) return;
  const id = row.dataset.id; const act = b.dataset.act;
  if (act === 'open') { openLeadModal(id); return; }
  if (act === 'called') { await updateLead(id, { status: 'epik', nextAction: addDays(3) }, 'status', 'Κλήθηκε → Επικοινωνία, επανέλεγχος σε 3 μέρες'); toast('ΟΚ — επανέλεγχος σε 3 μέρες.'); }
  if (act === 'p1') { await updateLead(id, { nextAction: addDays(1) }, 'next', 'Μετάθεση για αύριο'); }
  if (act === 'p3') { await updateLead(id, { nextAction: addDays(3) }, 'next', 'Μετάθεση +3 μέρες'); }
  if (act === 'p7') { await updateLead(id, { nextAction: addDays(7) }, 'next', 'Μετάθεση +7 μέρες'); }
  if (act === 'done') { await updateLead(id, { nextAction: null }, 'next', 'Η ενέργεια ολοκληρώθηκε'); }
  if (act === 'marklost') { await updateLead(id, { status: 'lost', nextAction: null }, 'status', 'Έκλεισε ως χαμένο (αδράνεια 21+ ημερών)'); }
});

/* ============ LEAD MODAL ============ */
let modalLeadId = null;
function openLeadModal(id) {
  const l = leadById(id); if (!l) return;
  modalLeadId = id;
  $('lmName').textContent = l.name;
  const c = clinicById(l.clinicId);
  const d = l.createdTime ? new Date(l.createdTime) : null;
  $('lmMeta').innerHTML = [
    c ? esc(c.name) : null,
    l.phone ? `<span class="mono">${esc(l.phone)}</span> <button class="copybtn" data-copy="${esc(l.phone)}" title="Αντιγραφή">${COPY_ICON}</button>` : null,
    l.email ? esc(l.email) : null,
    l.campaign ? 'Καμπάνια: ' + esc(l.campaign) : null,
    d && !isNaN(d) ? 'Ήρθε ' + d.toLocaleDateString('el-GR', { day: 'numeric', month: 'long' }) : null,
  ].filter(Boolean).join(' · ');
  const sc = c && c.script;
  $('lmScript').hidden = !sc;
  if (sc) $('lmScript').innerHTML = '<b>Σενάριο κλήσης</b>' + esc(sc);
  const tpls = c && Array.isArray(c.templates) ? c.templates : [];
  $('lmTemplates').hidden = !tpls.length;
  $('lmTemplates').innerHTML = tpls.map((t, i) => `<button class="btn small" data-tpl="${i}" title="Αντιγραφή μηνύματος">${esc(t.t)}</button>`).join('');
  $('lmTemplates').dataset.clinic = c ? c.id : '';
  $('lm_status').innerHTML = Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${l.status === k ? ' selected' : ''}>${v}</option>`).join('');
  $('lm_next').value = l.nextAction || '';
  $('lm_amount').value = l.amount || '';
  $('lm_notes').value = l.notes || '';
  renderTimeline(l);
  $('leadModal').hidden = false;
}
function renderTimeline(l) {
  const items = S.act.filter((a) => a.leadId === l.id)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const TYPES = { create: 'ΝΕΟ', import: 'IMPORT', status: 'ΣΤΑΔΙΟ', note: 'ΣΧΟΛΙΟ', amount: 'ΠΩΛΗΣΗ', next: 'ΕΝΕΡΓΕΙΑ' };
  let html = items.map((a) => `<div class="tlrow">
      <span class="at">${new Date(a.at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit' })} ${new Date(a.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="ty">${TYPES[a.type] || 'ℹ'}</span>
      <span>${esc(a.body)}${a.by ? ` <span style="color:var(--soft)">— ${esc(a.by.split('@')[0])}</span>` : ''}</span>
    </div>`).join('');
  if (l.sheetNotes) html += `<div class="tlrow"><span class="at">sheet</span><span class="ty">ΣΗΜ.</span><span>${esc(l.sheetNotes)}</span></div>`;
  $('lmTimeline').innerHTML = html || '<div class="tlrow"><span style="color:var(--soft)">Καμία καταγραφή ακόμα.</span></div>';
}
$('lmTemplates').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tpl]'); if (!b || !modalLeadId) return;
  const l = leadById(modalLeadId); const c = l && clinicById(l.clinicId);
  const t = c && c.templates && c.templates[+b.dataset.tpl]; if (!t) return;
  const first = (l.name || '').trim().split(/\s+/)[0] || '';
  const text = t.b.replaceAll('{όνομα}', first).replaceAll('{name}', first);
  try { navigator.clipboard.writeText(text).then(() => toast('Αντιγράφηκε το μήνυμα «' + t.t + '».')).catch(() => toast(text)); } catch { toast(text); }
});
$('lmClose').onclick = () => { $('leadModal').hidden = true; modalLeadId = null; };
$('leadModal').addEventListener('click', (e) => { if (e.target === $('leadModal')) { $('leadModal').hidden = true; modalLeadId = null; } });
$('lm_status').addEventListener('change', async () => {
  if (!modalLeadId) return;
  const v = $('lm_status').value;
  const patch = { status: v };
  if (v === 'won') patch.saleDate = todayISO();
  await updateLead(modalLeadId, patch, 'status', 'Στάδιο → ' + STATUS[v]);
  const l = leadById(modalLeadId); if (l) renderTimeline(l);
});
$('lm_next').addEventListener('change', async () => {
  if (!modalLeadId) return;
  const v = $('lm_next').value || null;
  await updateLead(modalLeadId, { nextAction: v }, 'next', v ? 'Επόμενη ενέργεια: ' + v : 'Καθαρίστηκε η επόμενη ενέργεια');
  const l = leadById(modalLeadId); if (l) renderTimeline(l);
});
$('lm_amount').addEventListener('change', async () => {
  if (!modalLeadId) return;
  const v = parseNum($('lm_amount').value);
  await updateLead(modalLeadId, { amount: v }, 'amount', 'Ποσό αγοράς: ' + eur(v));
  const l = leadById(modalLeadId); if (l) renderTimeline(l);
});
$('lm_notes').addEventListener('change', async () => {
  if (!modalLeadId) return;
  await updateLead(modalLeadId, { notes: $('lm_notes').value }, null);
});
$('lm_addComment').onclick = async () => {
  const t = $('lm_comment').value.trim();
  if (!t || !modalLeadId) return;
  $('lm_comment').value = '';
  await logAct(modalLeadId, 'note', t);
  await refresh();
  const l = leadById(modalLeadId); if (l) renderTimeline(l);
};
$('lm_comment').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lm_addComment').click(); });
$('lm_gdpr').onclick = async () => {
  if (!modalLeadId) return;
  const b = $('lm_gdpr');
  if (b.textContent !== 'Σίγουρα; Οριστικό & μη αναστρέψιμο') { b.textContent = 'Σίγουρα; Οριστικό & μη αναστρέψιμο'; setTimeout(() => { b.textContent = 'Οριστική διαγραφή (GDPR)'; }, 3500); return; }
  b.disabled = true;
  const id = modalLeadId;
  try {
    for (const a of S.act.filter((x) => x.leadId === id)) await data.remove('activity', a.id);
    for (const t of (S.trash || []).filter((x) => x.coll === 'leads' && x.docId === id)) await data.remove('trash', t.id);
    await data.remove('leads', id);
    $('leadModal').hidden = true; modalLeadId = null;
    await refresh();
    toast('Το lead διαγράφηκε οριστικά (GDPR) — μαζί με όλο το ιστορικό του.');
  } catch (e) { toast('Αποτυχία: ' + e.message); }
  b.disabled = false; b.textContent = 'Οριστική διαγραφή (GDPR)';
};

/* ============ CALENDAR ============ */
let calOffset = 0;
$('calPrev').onclick = () => { calOffset--; renderCalendar(); };
$('calNext').onclick = () => { calOffset++; renderCalendar(); };
$('calToday').onclick = () => { calOffset = 0; renderCalendar(); };

/* ---- Google Calendar σύνδεση ---- */
const gcalKey = () => SET().gcalApiKey || '';
const gcalClient = () => SET().gcalClientId || '';
const gcalId = () => SET().gcalCalendarId || gcal.DEFAULT_CAL_ID;
const gcalCache = {}; // monthKey -> events[] | 'loading' | 'error'
function calMonthKey() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  return first.getFullYear() + '-' + String(first.getMonth() + 1).padStart(2, '0');
}
function loadGcalMonth(mk) {
  if (gcalCache[mk]) return;
  if (!gcalKey() && !gcalClient()) return;
  gcalCache[mk] = 'loading';
  gcal.listEvents({ apiKey: gcalKey(), clientId: gcalClient() }, gcalId(), mk).then((evs) => {
    gcalCache[mk] = evs;
    if (activeTab === 'calendar') renderCalendar();
    if (activeTab === 'today') renderToday();
  }).catch((e) => {
    gcalCache[mk] = e.code === 'connect_needed' ? 'connect' : 'error';
    if (activeTab === 'calendar') renderCalendar();
    if (activeTab === 'today') renderToday();
  });
}
function invalidateGcal(mk) { delete gcalCache[mk]; }

function renderCalendar() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  const mk = calMonthKey();
  $('calTitle').textContent = mLabel(mk);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // Δευτέρα πρώτη
  const today = todayISO();
  /* Google Calendar: κατάσταση + συμβάντα μήνα */
  loadGcalMonth(mk);
  const gevByDate = {};
  const gc = gcalCache[mk];
  if (Array.isArray(gc)) gc.forEach((ev) => { (gevByDate[ev.date] = gevByDate[ev.date] || []).push(ev); });
  $('gcalState').innerHTML = (!gcalKey() && !gcalClient()) ? 'Google Calendar: μη συνδεδεμένο (Ρυθμίσεις)'
    : gc === 'connect' ? '<button class="btn small primary" id="btnGcalConnect">Σύνδεση Google (μία φορά, για όλη την ομάδα)</button>'
    : gc === 'loading' ? 'Φόρτωση Google Calendar…'
    : gc === 'error' ? 'Σφάλμα Google Calendar — δοκίμασε ανανέωση'
    : 'Google Calendar: συνδεδεμένο ✓';
  const cb = document.getElementById('btnGcalConnect');
  if (cb) cb.onclick = async () => {
    cb.disabled = true; cb.textContent = 'Σύνδεση…';
    try { await gcal.connectPermanent(gcalClient()); Object.keys(gcalCache).forEach((k) => delete gcalCache[k]); toast('Το ημερολόγιο συνδέθηκε μόνιμα για όλη την ομάδα ✓'); renderCalendar(); }
    catch (e) { toast(e.message); renderCalendar(); }
  };
  $('gcalFallback').hidden = true;
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="calday dim"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const key = `${mk}-${String(d).padStart(2, '0')}`;
    const gevs = (gevByDate[key] || []);
    cells += `<div class="calday${key === today ? ' today' : ''}" data-date="${key}"><div class="dn">${d}</div>`
      + gevs.slice(0, 5).map((ev) => `<button class="calev gev" data-gev="${esc(ev.id)}" title="${esc(ev.title + (ev.start ? ' · ' + ev.start : ''))}">${ev.start ? `<span class="mono">${ev.start}</span> ` : ''}${esc(ev.title)}</button>`).join('')
      + (gevs.length > 5 ? `<div class="calmore">+${gevs.length - 5} ακόμα</div>` : '')
      + (gevs.length > 2 ? `<div class="calmore m">+${gevs.length - 2}</div>` : '')
      + '</div>';
  }
  const total = startDow + daysIn;
  for (let i = total; i % 7 !== 0; i++) cells += '<div class="calday dim"></div>';
  $('calGrid').innerHTML = '<div class="calhead"><div>Δευ</div><div>Τρί</div><div>Τετ</div><div>Πέμ</div><div>Παρ</div><div>Σάβ</div><div>Κυρ</div></div>'
    + `<div class="calgrid">${cells}</div>`;
  /* Κινητό: τα κελιά είναι στενά, οπότε κάτω από το πλέγμα μπαίνει λίστα με όλα τα συμβάντα του μήνα. */
  const days = Object.keys(gevByDate).filter((k) => k >= today).sort(); // ό,τι πέρασε φεύγει — μόνο από σήμερα και μετά
  $('calAgenda').innerHTML = days.length ? days.map((key) => `<div class="taskday${key === today ? ' today' : ''}">${new Date(key + 'T12:00:00').toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' })}${key === today ? ' · σήμερα' : ''}</div>`
    + gevByDate[key].map((ev) => `<button class="agrow" data-gev="${esc(ev.id)}"><span class="mono">${ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : 'όλη μέρα'}</span><span>${esc(ev.title)}</span></button>`).join('')).join('')
    : '<div class="empty">Κανένα επόμενο συμβάν αυτόν τον μήνα.</div>';
}

/* ---- event modal (δημιουργία/επεξεργασία στο πραγματικό Google Calendar) ---- */
/* Ώρες σε 24ωρο, 08:00–22:00 ανά μισάωρο — χωρίς AM/PM πουθενά. */
const TIME_OPTS = (() => {
  const out = [];
  for (let h = 8; h <= 22; h++) for (const m of ['00', '30']) {
    if (h === 22 && m === '30') continue;
    out.push(String(h).padStart(2, '0') + ':' + m);
  }
  return out;
})();
function fillTimeSelect(sel, value, emptyLabel) {
  const opts = [...TIME_OPTS];
  if (value && !opts.includes(value)) { opts.push(value); opts.sort(); }
  sel.innerHTML = `<option value="">${emptyLabel}</option>` + opts.map((t) => `<option value="${t}"${t === value ? ' selected' : ''}>${t}</option>`).join('');
}
$('ev_start').addEventListener('change', () => {
  const s = $('ev_start').value;
  if (!s) { $('ev_end').value = ''; return; }
  if (!$('ev_end').value) {
    const [h, m] = s.split(':').map(Number);
    const end = String(Math.min(22, h + 1)).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    fillTimeSelect($('ev_end'), end, '—');
  }
});
let editEventId = null;
function openEventModal(ev, presetDate) {
  if (!gcalKey()) { toast('Σύνδεσε πρώτα το Google Calendar στις Ρυθμίσεις (API key).'); return; }
  if (!gcalClient()) { toast('Για δημιουργία/αλλαγή συμβάντων χρειάζεται OAuth Client ID στις Ρυθμίσεις.'); return; }
  editEventId = ev ? ev.id : null;
  $('evTitle').textContent = ev ? 'Επεξεργασία συμβάντος' : 'Νέο συμβάν';
  $('ev_title').value = ev ? ev.title : '';
  $('ev_date').value = ev ? ev.date : (presetDate || todayISO());
  fillTimeSelect($('ev_start'), ev ? ev.start : '', '— (ολοήμερο)');
  fillTimeSelect($('ev_end'), ev ? ev.end : '', '—');
  // Τηλέφωνο: αποθηκεύεται ως γραμμή «Τηλ: …» μέσα στην περιγραφή του Google event
  let notes = ev ? ev.desc : '';
  let phone = '';
  const pm = notes.match(/^Τηλ:\s*(.+)$/m);
  if (pm) { phone = pm[1].trim(); notes = notes.replace(/^Τηλ:.*$/m, '').trim(); }
  $('ev_desc').value = notes;
  $('ev_phone').value = phone;
  $('ev_email').value = ev && ev.attendees ? ev.attendees.join(', ') : '';
  $('ev_meet').checked = !!(ev && ev.meet);
  const ml = $('evMeetLink');
  ml.hidden = !(ev && ev.meet);
  if (ev && ev.meet) ml.innerHTML = `Meet: <a href="${esc(ev.meet)}" target="_blank" rel="noopener">${esc(ev.meet)}</a> <button class="copybtn" data-copy="${esc(ev.meet)}" title="Αντιγραφή">${COPY_ICON}</button>`;
  $('evDelete').hidden = !ev;
  $('evModal').hidden = false;
  $('ev_title').focus();
}
$('evClose').onclick = () => { $('evModal').hidden = true; };
$('evModal').addEventListener('click', (e) => { if (e.target === $('evModal')) $('evModal').hidden = true; });
$('btnNewEvent').onclick = () => openEventModal(null);
$('evSave').onclick = async () => {
  const title = $('ev_title').value.trim();
  if (!title) { toast('Γράψε τίτλο.'); return; }
  let desc = $('ev_desc').value.trim();
  const phone = $('ev_phone').value.trim();
  if (phone) desc = (desc ? desc + '\n' : '') + 'Τηλ: ' + phone;
  const attendees = $('ev_email').value.split(',').map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x));
  const ev = {
    title, desc, date: $('ev_date').value || todayISO(), start: $('ev_start').value, end: $('ev_end').value,
    attendees, meet: $('ev_meet').checked,
  };
  $('evSave').disabled = true;
  try {
    if (editEventId) await gcal.patchEvent(gcalClient(), gcalId(), editEventId, ev);
    else await gcal.createEvent(gcalClient(), gcalId(), ev);
    invalidateGcal(monthKey(ev.date)); invalidateGcal(calMonthKey());
    $('evModal').hidden = true;
    toast(editEventId ? 'Το συμβάν ενημερώθηκε στο Google Calendar.' : 'Το συμβάν δημιουργήθηκε στο Google Calendar.');
    renderCalendar();
    if (activeTab === 'today') renderToday();
  } catch (e) { toast(e.message); }
  $('evSave').disabled = false;
};
$('evDelete').onclick = async () => {
  if (!editEventId) return;
  const b = $('evDelete');
  if (b.textContent !== 'Σίγουρα διαγραφή;') { b.textContent = 'Σίγουρα διαγραφή;'; setTimeout(() => { b.textContent = 'Διαγραφή'; }, 2500); return; }
  b.disabled = true;
  try {
    await gcal.deleteEvent(gcalClient(), gcalId(), editEventId);
    invalidateGcal(calMonthKey()); invalidateGcal(nowMonth()); invalidateGcal(monthKey(addDays(1)));
    $('evModal').hidden = true;
    toast('Το συμβάν διαγράφηκε από το Google Calendar.');
    renderCalendar();
    if (activeTab === 'today') renderToday();
  } catch (e) { toast(e.message); }
  b.disabled = false; b.textContent = 'Διαγραφή';
};
function openGev(id) {
  const ev = Object.values(gcalCache).filter(Array.isArray).flat().find((x) => x.id === id);
  if (ev) openEventModal(ev);
}
$('calAgenda').addEventListener('click', (e) => { const g = e.target.closest('[data-gev]'); if (g) openGev(g.dataset.gev); });
$('calGrid').addEventListener('click', (e) => {
  const g = e.target.closest('[data-gev]');
  if (g) { openGev(g.dataset.gev); return; }
  const day = e.target.closest('.calday:not(.dim)');
  if (day && day.dataset.date && gcalClient()) openEventModal(null, day.dataset.date);
});

/* ============ ONBOARDING ============ */
const OB_STEPS = [
  ['contract', 'Υπογραφή συμφωνητικού'],
  ['meta', 'Πρόσβαση σε Meta Business / Ad account'],
  ['pixel', 'Εγκατάσταση Pixel / CAPI'],
  ['form', 'Lead form έτοιμη και δοκιμασμένη'],
  ['sheet', 'Google Sheet leads συνδεδεμένο'],
  ['campaign', 'Πρώτη καμπάνια live'],
  ['report', 'Αναφορά 1ου μήνα στάλθηκε'],
];
let obClinicId = null;
function obState(c) {
  const ob = c.onboarding || {};
  return OB_STEPS.map(([k, lb]) => [k, lb, k === 'sheet' ? !!(ob[k] || c.sheetId) : k === 'meta' ? !!(ob[k] || c.metaAdAccount) : !!ob[k]]);
}
function openObModal(id) {
  const c = clinicById(id); if (!c) return;
  obClinicId = id;
  $('obName').textContent = 'Setup · ' + c.name;
  $('obSteps').innerHTML = obState(c).map(([k, lb, done]) => `
    <label class="obrow ${done ? 'done' : ''}"><input type="checkbox" data-ob="${k}"${done ? ' checked' : ''}><span>${lb}</span>${(k === 'sheet' && c.sheetId) || (k === 'meta' && c.metaAdAccount) ? '<span class="auto">αυτόματο ✓</span>' : ''}</label>`).join('');
  $('obModal').hidden = false;
}
$('obClose').onclick = () => { $('obModal').hidden = true; obClinicId = null; };
$('obModal').addEventListener('click', (e) => { if (e.target === $('obModal')) { $('obModal').hidden = true; obClinicId = null; } });
$('obSteps').addEventListener('change', async (e) => {
  const k = e.target.dataset.ob; if (!k || !obClinicId) return;
  const c = clinicById(obClinicId); if (!c) return;
  const ob = { ...(c.onboarding || {}), [k]: e.target.checked };
  try { await data.update('clinics', obClinicId, { onboarding: ob }); await refresh(); openObModal(obClinicId); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});

/* ============ SEARCH (Cmd+K) ============ */
let searchRows = [], searchSel = 0;
function openSearch() { $('searchModal').hidden = false; $('searchInput').value = ''; renderSearch(''); $('searchInput').focus(); }
function closeSearch() { $('searchModal').hidden = true; }
function renderSearch(q) {
  q = q.trim().toLowerCase();
  let rows = [];
  const cl = S.clinics.filter((c) => !q || (c.name + ' ' + (c.doctor || '')).toLowerCase().includes(q))
    .map((c) => ({ type: 'clinic', id: c.id, label: c.name, sub: c.specialty || '' }));
  const ld = S.leads.filter((l) => q && ((l.name || '') + ' ' + (l.phone || '') + ' ' + (l.email || '')).toLowerCase().includes(q))
    .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')))
    .map((l) => { const c = clinicById(l.clinicId); return { type: 'lead', id: l.id, label: l.name, sub: [c && c.name, l.phone].filter(Boolean).join(' · ') }; });
  if (q) rows = [...ld.slice(0, 10), ...cl.slice(0, 4)];
  else rows = S.leads.slice().sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || ''))).slice(0, 6)
    .map((l) => { const c = clinicById(l.clinicId); return { type: 'lead', id: l.id, label: l.name, sub: [c && c.name, l.phone].filter(Boolean).join(' · ') }; });
  searchRows = rows; searchSel = 0;
  $('searchResults').innerHTML = rows.length
    ? rows.map((r, i) => `<button class="sres${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="stype">${r.type === 'lead' ? 'lead' : 'κλιν.'}</span><b>${esc(r.label)}</b><span class="ssub">${esc(r.sub)}</span></button>`).join('')
    : '<div class="snone">Τίποτα δεν βρέθηκε.</div>';
}
function chooseSearch(i) {
  const r = searchRows[i]; if (!r) return;
  closeSearch();
  if (r.type === 'lead') openLeadModal(r.id);
  else showTab('clinics');
}
$('btnSearch').onclick = openSearch;
$('btnSearchM').onclick = openSearch;
/* mobile bottom bar + «Μενού» sheet */
$('mtabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'btnMore') { openMoreSheet(); return; }
  if (b.dataset.tab) showTab(b.dataset.tab);
});
function openMoreSheet() {
  const visible = TABS.filter((t) => { const rb = document.querySelector(`#tabs button[data-tab="${t}"]`); return rb && !rb.hidden; });
  $('moreSheetBody').innerHTML = '<div class="sheetgrid">'
    + visible.map((t) => {
      const rb = document.querySelector(`#tabs button[data-tab="${t}"]`);
      const svg = rb ? (rb.querySelector('svg') || { outerHTML: '' }).outerHTML : '';
      return `<button data-tab="${t}" class="${t === activeTab ? 'on' : ''}">${svg}${TAB_LABELS[t]}</button>`;
    }).join('')
    + `</div><div class="sheetfoot"><span>${esc(userEmail())}</span><span style="display:flex;gap:8px"><button class="btn small" id="sheetReload">⟳ Ανανέωση app</button><button class="btn small" id="sheetLogout">Αποσύνδεση</button></span></div>`;
  $('moreSheet').hidden = false;
}
$('moreSheet').addEventListener('click', (e) => {
  if (e.target === $('moreSheet')) { $('moreSheet').hidden = true; return; }
  if (e.target.closest('#sheetLogout')) { logout(); location.href = '/login/'; return; }
  if (e.target.closest('#sheetReload')) { reloadApp(); return; }
  const b = e.target.closest('button[data-tab]');
  if (b) { $('moreSheet').hidden = true; showTab(b.dataset.tab); }
});
$('searchInput').addEventListener('input', () => renderSearch($('searchInput').value));
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    searchSel = Math.max(0, Math.min(searchRows.length - 1, searchSel + (e.key === 'ArrowDown' ? 1 : -1)));
    document.querySelectorAll('.sres').forEach((el, i) => el.classList.toggle('sel', i === searchSel));
    const cur = document.querySelector('.sres.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') chooseSearch(searchSel);
});
$('searchResults').addEventListener('click', (e) => { const b = e.target.closest('.sres'); if (b) chooseSearch(+b.dataset.i); });
$('searchModal').addEventListener('click', (e) => { if (e.target === $('searchModal')) closeSearch(); });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Escape') ['searchModal', 'leadModal', 'evModal', 'obModal', 'moreSheet'].forEach((m) => { $(m).hidden = true; });
});

/* ============ CLINICS ============ */
let editClinicId = null;
$('btnNewClinic').onclick = () => {
  editClinicId = null; $('clinicFormTitle').textContent = 'Νέα κλινική';
  ['cf_name', 'cf_doctor', 'cf_spec', 'cf_phone', 'cf_email', 'cf_portalEmail', 'cf_fee', 'cf_sharePct', 'cf_dailyBudget', 'cf_monthlyBudget', 'cf_goalLeads', 'cf_goalSales', 'cf_contractStart', 'cf_contractEnd', 'cf_nextTouch', 'cf_tags', 'cf_contacts', 'cf_sheet', 'cf_metaAd', 'cf_script', 'cf_templates', 'cf_notes'].forEach((i) => { $(i).value = ''; });
  $('clinicForm').hidden = false; $('cf_name').focus();
};
$('btnCancelClinic').onclick = () => { $('clinicForm').hidden = true; };
$('btnSaveClinic').onclick = async () => {
  const name = $('cf_name').value.trim();
  if (!name) { toast('Γράψε όνομα κλινικής.'); return; }
  const sheetUrl = $('cf_sheet').value.trim();
  const d = {
    name, doctor: $('cf_doctor').value.trim(), specialty: $('cf_spec').value.trim(),
    phone: $('cf_phone').value.trim(), email: $('cf_email').value.trim(), portalEmail: $('cf_portalEmail').value.trim(), fee: parseNum($('cf_fee').value),
    billingModel: $('cf_billingModel').value, sharePct: parseNum($('cf_sharePct').value) || 50,
    dailyBudget: parseNum($('cf_dailyBudget').value), monthlyBudget: parseNum($('cf_monthlyBudget').value),
    goalLeads: Math.round(parseNum($('cf_goalLeads').value)), goalSales: Math.round(parseNum($('cf_goalSales').value)),
    contractStart: $('cf_contractStart').value || null, contractEnd: $('cf_contractEnd').value || null,
    status: $('cf_status').value, nextTouch: $('cf_nextTouch').value || null,
    tags: $('cf_tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    contacts: $('cf_contacts').value.split('\n').map((ln) => {
      const p = ln.split('|').map((x) => x.trim());
      return p[0] ? { name: p[0], role: p[1] || '', phone: p[2] || '', email: p[3] || '' } : null;
    }).filter(Boolean),
    script: $('cf_script').value.trim(),
    templates: $('cf_templates').value.split('\n').map((ln) => {
      const i = ln.indexOf(':'); if (i < 1) return null;
      return { t: ln.slice(0, i).trim(), b: ln.slice(i + 1).trim() };
    }).filter((x) => x && x.t && x.b),
    sheetUrl, sheetId: sheetIdFrom(sheetUrl) || '', metaAdAccount: $('cf_metaAd').value.trim(), notes: $('cf_notes').value.trim(),
  };
  let saved;
  try {
    if (editClinicId) saved = await data.update('clinics', editClinicId, d);
    else saved = await data.create('clinics', { ...d, createdAt: new Date().toISOString() });
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  $('clinicForm').hidden = true;
  toast(editClinicId ? 'Η κλινική ενημερώθηκε.' : `Η κλινική «${name}» δημιουργήθηκε.`);
  editClinicId = null;
  await refresh();
  if (d.sheetId && saved) {
    const n = await syncClinic({ ...d, id: saved.id }, true);
    if (n) toast(`Συγχρονίστηκαν ${n} leads από το sheet.`);
  }
  if (d.portalEmail && saved && CONFIG.backend === 'supabase') createPortalAccount(d.portalEmail, saved.id, d.name);
};
/* Λογαριασμός Client Portal μέσω edge function (μόνο ομάδα). */
async function createPortalAccount(email, clinicId, clinicName) {
  let res;
  try {
    res = await callFunction('create-client', { email, clinicId, clinicName });
  } catch (e) {
    if (String(e.message).includes('already')) toast('Υπάρχει ήδη λογαριασμός με αυτό το email.');
    else toast('Ο λογαριασμός portal δεν δημιουργήθηκε: ' + e.message);
    return;
  }
  const portalUrl = location.origin + '/client-portal/';
  const creds = `Astra Client Portal\n${portalUrl}\nEmail: ${res.email}\nΚωδικός: ${res.password}`;
  try { await navigator.clipboard.writeText(creds); } catch { /* ok */ }
  // Αυτόματο email καλωσορίσματος με τα στοιχεία σύνδεσης (Gmail της ομάδας)
  try {
    await sendEmail(gcalClient(), { to: res.email, ...welcomeEmail({ clinicName, email: res.email, password: res.password, portalUrl }) });
    toast('Λογαριασμός δημιουργήθηκε και στάλθηκε email καλωσορίσματος στον πελάτη ✓');
  } catch (e) {
    toast('Λογαριασμός ΟΚ, αλλά το email δεν στάλθηκε (' + e.message + ') — τα στοιχεία είναι στο clipboard.');
  }
}
function goalBar(label, cur, goal) {
  if (!goal) return '';
  const pct = Math.min(100, Math.round(100 * cur / goal));
  return `<div class="goal"><span>${label}</span><span class="bar"><i class="${pct >= 100 ? 'ok' : ''}" style="width:${pct}%"></i></span><b>${cur}/${goal}</b></div>`;
}
const CLINIC_STATUS = { prospect: ['Υποψήφιος', 'neo'], active: ['Ενεργός', 'won'], paused: ['Σε παύση', 'epik'], ended: ['Ολοκληρώθηκε', 'plain'] };
const CLOG_TYPES = { note: 'Σημείωση', call: 'Κλήση', meeting: 'Meeting', decision: 'Απόφαση' };
/* Health score πελάτη: r/y/g + λόγοι. */
function clinicHealth(c) {
  const mk = nowMonth();
  const reasons = [];
  let level = 'g';
  const bump = (lv, why) => { reasons.push(why); if (lv === 'r' || level === 'r') level = 'r'; else level = 'y'; };
  const d = contractDays(c);
  if (d !== null && d < 0) bump('r', 'Συμβόλαιο ληγμένο');
  else if (d !== null && d <= 30) bump('y', 'Συμβόλαιο λήγει σε ' + d + 'μ');
  const st = computeStats(mk, c);
  if (st.spend > 100 && st.roas < 1 && st.leads > 0) bump('r', 'ROAS ' + st.roas.toFixed(2) + '× αυτόν τον μήνα');
  if (+c.monthlyBudget > 0 && st.spend > +c.monthlyBudget) bump('y', 'Υπέρβαση budget');
  if (c.sheetId && c.lastSync && Date.now() - new Date(c.lastSync).getTime() > 7 * 86400000) bump('y', 'Sync leads πάνω από 7 μέρες');
  const stale = S.leads.filter((l) => l.clinicId === c.id && ['epik', 'rv', 'show'].includes(l.status) && (!l.nextAction || l.nextAction < todayISO()));
  if (stale.length > 5) bump('y', stale.length + ' leads χωρίς προγραμματισμένη ενέργεια');
  if (c.status === 'paused') bump('y', 'Σε παύση');
  if (!reasons.length) reasons.push('Όλα καλά');
  return { level, reasons };
}
async function addClientLog(clinicId, type, body) {
  await data.create('client_log', { clinicId, at: new Date().toISOString(), by: userEmail(), type, body }, 'cl' + uid());
}
function contractDays(c) {
  if (!c.contractEnd) return null;
  return Math.ceil((new Date(c.contractEnd).getTime() - Date.now()) / 86400000);
}
function contractMeta(c) {
  const d = contractDays(c);
  if (d === null) return '';
  const dt = new Date(c.contractEnd).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: '2-digit' });
  if (d < 0) return ` · <span class="neg">Συμβόλαιο έληξε ${dt}</span>`;
  if (d <= 30) return ` · <span class="neg">Συμβόλαιο έως ${dt} (${d}μ)</span>`;
  return ' · Συμβόλαιο έως ' + dt;
}
function openClinicEdit(id) {
  const c = clinicById(id); if (!c) return;
  showTab('clinics');
  editClinicId = id; $('clinicFormTitle').textContent = 'Επεξεργασία κλινικής';
  $('cf_name').value = c.name || ''; $('cf_doctor').value = c.doctor || ''; $('cf_spec').value = c.specialty || '';
  $('cf_phone').value = c.phone || ''; $('cf_email').value = c.email || ''; $('cf_portalEmail').value = c.portalEmail || ''; $('cf_fee').value = c.fee || '';
  $('cf_billingModel').value = c.billingModel || 'appointment'; $('cf_sharePct').value = c.sharePct ?? 50;
  $('cf_dailyBudget').value = c.dailyBudget || ''; $('cf_monthlyBudget').value = c.monthlyBudget || '';
  $('cf_goalLeads').value = c.goalLeads || ''; $('cf_goalSales').value = c.goalSales || '';
  $('cf_contractStart').value = c.contractStart || ''; $('cf_contractEnd').value = c.contractEnd || '';
  $('cf_status').value = c.status || 'active'; $('cf_nextTouch').value = c.nextTouch || '';
  $('cf_tags').value = (Array.isArray(c.tags) ? c.tags : []).join(', ');
  $('cf_contacts').value = (Array.isArray(c.contacts) ? c.contacts : []).map((x) => [x.name, x.role, x.phone, x.email].join(' | ')).join('\n');
  $('cf_script').value = c.script || '';
  $('cf_templates').value = (Array.isArray(c.templates) ? c.templates : []).map((t) => t.t + ': ' + t.b).join('\n');
  $('cf_sheet').value = c.sheetUrl || ''; $('cf_metaAd').value = c.metaAdAccount || ''; $('cf_notes').value = c.notes || '';
  $('clinicForm').hidden = false; window.scrollTo({ top: 0 });
}
let confirmDelete = null;
let clinicFilter = '';
$('clinicFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cf]'); if (!b) return;
  clinicFilter = b.dataset.cf; renderClinics();
});
function renderClinics() {
  const counts = {};
  S.clinics.forEach((c) => { const k = c.status || 'active'; counts[k] = (counts[k] || 0) + 1; });
  $('clinicFilters').innerHTML = [['', 'Όλες (' + S.clinics.length + ')', 'plain'], ...Object.entries(CLINIC_STATUS).map(([k, [lb, cls]]) => [k, lb + ' (' + (counts[k] || 0) + ')', cls])]
    .map(([k, lb, cls]) => `<button class="chip ${cls}" data-cf="${k}" style="border:none;cursor:pointer;${clinicFilter === k ? 'outline:2px solid var(--bronze);outline-offset:1px' : ''}">${lb}</button>`).join('');
  const el = $('clinicList');
  if (!S.clinics.length) {
    el.innerHTML = '<div class="card empty" style="grid-column:1/-1"><div class="big">Καμία κλινική ακόμα</div>Πάτησε «Νέα κλινική», δώσε όνομα και (όταν ετοιμαστεί) το Google Sheet των leads — από εκεί και πέρα όλα ρέουν αυτόματα.</div>';
    return;
  }
  const mk = nowMonth();
  const list = clinicFilter ? S.clinics.filter((c) => (c.status || 'active') === clinicFilter) : S.clinics;
  el.innerHTML = list.map((c) => {
    const ls = S.leads.filter((l) => l.clinicId === c.id);
    const lsM = ls.filter((l) => monthKey(l.createdTime) === mk);
    const won = ls.filter((l) => l.status === 'won');
    const wonM = won.filter((l) => monthKey(l.saleDate || l.createdTime) === mk);
    const rev = won.reduce((s, l) => s + (+l.amount || 0), 0);
    const sync = c.lastSync ? new Date(c.lastSync).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
    const del = confirmDelete === c.id;
    return `<div class="card cliniccard" data-id="${c.id}">
      <div><h3 data-act="view" style="cursor:pointer"><span class="hdot ${clinicHealth(c).level}" title="${esc(clinicHealth(c).reasons.join(' · '))}"></span>${esc(c.name)} ›</h3>
      <div class="spec">${(() => { const st = CLINIC_STATUS[c.status || 'active']; return `<span class="chip ${st[1]}" style="font-size:10.5px;padding:1px 8px">${st[0]}</span> `; })()}${esc([c.specialty, c.doctor].filter(Boolean).join(' · '))}${(Array.isArray(c.tags) && c.tags.length) ? '<br>' + c.tags.map((t) => `<span class="tagchip">${esc(t)}</span>`).join('') : ''}</div></div>
      <div class="stats">
        <div><b>${ls.length}</b><i>Leads</i></div>
        <div><b>${ls.filter((l) => ['rv', 'show'].includes(l.status)).length}</b><i>Ραντεβού</i></div>
        <div><b>${won.length}</b><i>Πελάτες</i></div>
        <div><b>${eur(rev)}</b><i>Έσοδα</i></div>
      </div>
      ${goalBar('Leads', lsM.length, c.goalLeads)}${goalBar('Πωλήσεις', wonM.length, c.goalSales)}
      ${(() => { const st = obState(c); const done = st.filter((x) => x[2]).length; return done < st.length ? goalBar('Setup', done, st.length) : ''; })()}
      <div class="meta">${c.fee ? 'Αμοιβή ' + eur(c.fee) + '/μήνα' : 'Χωρίς αμοιβή'}${c.sheetId ? (sync ? ' · Sync ' + sync : ' · Sheet συνδεδεμένο') : ' · Χωρίς sheet'}${contractMeta(c)}</div>
      <div class="foot">
        <button class="btn small primary" data-act="view">Άνοιγμα</button>
        ${contractDays(c) !== null && contractDays(c) <= 45 ? '<button class="btn small" data-act="renew" title="Μετάθεση λήξης +12 μήνες">Ανανέωση +12μ</button>' : ''}
        ${c.sheetId ? '<button class="btn small" data-act="sync">⟳ Συγχρονισμός</button>' : ''}
        <button class="btn small" data-act="csv" title="Εισαγωγή leads από αρχείο CSV">CSV</button>
        <button class="btn small" data-act="setup" title="Onboarding checklist">Setup</button>
        <button class="btn small" data-act="edit">Επεξεργασία</button>
        ${del ? '<button class="btn small danger" data-act="del2">Σίγουρα διαγραφή;</button><button class="btn small" data-act="delno">Όχι</button>'
              : '<button class="btn small danger" data-act="del">Διαγραφή</button>'}
      </div></div>`;
  }).join('');
}
$('clinicList').addEventListener('click', async (e) => {
  const b = e.target.closest('button, h3[data-act]'); if (!b) return;
  const id = b.closest('.cliniccard').dataset.id; const c = clinicById(id); if (!c) return;
  const act = b.dataset.act;
  if (act === 'sync') {
    b.disabled = true; b.textContent = 'Συγχρονισμός…';
    const n = await syncClinic(c, false);
    b.disabled = false; b.textContent = '⟳ Συγχρονισμός';
    if (n >= 0) toast(n ? `Συγχρονίστηκαν ${n} νέα leads για «${c.name}».` : 'Κανένα νέο lead — όλα ενημερωμένα.');
  }
  if (act === 'csv') { csvClinicId = id; $('csvFile').click(); }
  if (act === 'setup') openObModal(id);
  if (act === 'renew') {
    const base = c.contractEnd && new Date(c.contractEnd) > new Date() ? new Date(c.contractEnd) : new Date();
    base.setFullYear(base.getFullYear() + 1);
    try { await data.update('clinics', id, { contractEnd: isoDate(base) }); toast('Το συμβόλαιο ανανεώθηκε έως ' + base.toLocaleDateString('el-GR')); await refresh(); }
    catch (err) { toast('Αποτυχία: ' + err.message); }
  }
  if (act === 'view') { showClinic(id); return; }
  if (act === 'edit') { openClinicEdit(id); }

  if (act === 'del') { confirmDelete = id; renderClinics(); }
  if (act === 'delno') { confirmDelete = null; renderClinics(); }
  if (act === 'del2') {
    confirmDelete = null;
    try {
      await trashRemove('clinics', id);
      let msg = 'Η κλινική μπήκε στον κάδο (Ρυθμίσεις) — τα leads της παραμένουν.';
      if (CONFIG.backend === 'supabase') {
        try {
          const r = await callFunction('create-client', { action: 'delete', clinicId: id });
          if (r.deleted) msg += ` Διαγράφηκε και ο λογαριασμός portal του πελάτη (${r.deleted}).`;
        } catch (e) { msg += ' (Ο λογαριασμός portal δεν διαγράφηκε: ' + e.message + ')'; }
      }
      toast(msg);
      await refresh();
    }
    catch (err) { toast('Η διαγραφή απέτυχε: ' + err.message); }
  }
});
$('btnSyncAll').onclick = async () => {
  const withSheet = S.clinics.filter((c) => c.sheetId);
  if (!withSheet.length) { toast('Καμία κλινική με συνδεδεμένο sheet ακόμα.'); return; }
  let tot = 0; for (const c of withSheet) tot += await syncClinic(c, true);
  toast(tot ? `Συγχρονίστηκαν ${tot} νέα leads συνολικά.` : 'Όλα ενημερωμένα — κανένα νέο lead.');
};

/* ============ CLINIC DETAIL (χώρος πελάτη) ============ */
let currentClinicId = null;
let clSub = 'overview';
const CL_SUBS = [['overview', 'Επισκόπηση'], ['crm', 'Ιστορικό & Επαφές'], ['leads', 'Leads'], ['calendar', 'Ημερολόγιο'], ['stats', 'Στατιστικά'], ['docs', 'Έγγραφα']];
function showClinic(id, sub) {
  currentClinicId = id;
  if (sub) clSub = sub;
  activeTab = 'clinic';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('on'));
  document.querySelectorAll('#mtabbar button[data-tab]').forEach((b) => b.classList.remove('on'));
  TABS.forEach((x) => { $('tab-' + x).hidden = true; });
  $('tab-clinic').hidden = false;
  const c = clinicById(id);
  $('mtopTitle').textContent = c ? c.name : 'Κλινική';
  if (history.replaceState) history.replaceState(null, '', '#clinics');
  window.scrollTo({ top: 0 });
  renderClinicView();
}
function clinicLeads(c) { return S.leads.filter((l) => l.clinicId === c.id); }
function renderClinicView() {
  const c = clinicById(currentClinicId);
  const el = $('clinicView');
  if (!c) { el.innerHTML = '<div class="card empty">Η κλινική δεν βρέθηκε.</div>'; return; }
  const ls = clinicLeads(c);
  const sNow = computeStats(nowMonth(), c);
  const head = `
    <button class="clback" data-act="back">‹ Κλινικές</button>
    <div class="clhead">
      <div>
        <h2><span class="hdot ${clinicHealth(c).level}" title="${esc(clinicHealth(c).reasons.join(' · '))}"></span>${esc(c.name)} <span class="chip ${CLINIC_STATUS[c.status || 'active'][1]}" style="vertical-align:4px">${CLINIC_STATUS[c.status || 'active'][0]}</span></h2>
        <div class="meta">${esc([c.specialty, c.doctor, c.phone].filter(Boolean).join(' · '))}${contractMeta(c)}${c.nextTouch ? ` · <b>Επόμενη επαφή: ${new Date(c.nextTouch).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</b>` : ''}${(+c.dailyBudget || +c.monthlyBudget) ? ' · Budget ' + [+c.dailyBudget ? eur(+c.dailyBudget) + '/ημ' : null, +c.monthlyBudget ? eur(+c.monthlyBudget) + '/μήνα' : null].filter(Boolean).join(' · ') : ''}</div>
      </div>
      <div class="acts">
        ${c.sheetId ? '<button class="btn small" data-act="clsync">⟳ Συγχρονισμός</button>' : ''}
        <button class="btn small" data-act="clnewlead">+ Lead</button>
        <button class="btn small" data-act="clsepa">${c.sepaStatus === 'active' ? 'SEPA ✓' : 'Σύνδεσμος SEPA'}</button>
        <button class="btn small" data-act="clsetup">Setup</button>
        <button class="btn small" data-act="cledit">Επεξεργασία</button>
      </div>
    </div>
    <div class="clsubs">${CL_SUBS.map(([k, lb]) => `<button data-clsub="${k}" class="${clSub === k ? 'on' : ''}">${lb}</button>`).join('')}</div>`;
  let body = '';
  if (clSub === 'overview') {
    const won = ls.filter((l) => l.status === 'won');
    const revAll = won.reduce((s, l) => s + (+l.amount || 0), 0);
    body = `<div class="tiles section">
        <div class="tile"><div class="lb">Leads · ${mLabel(nowMonth())}</div><div class="v">${sNow.leads}</div><div class="d">${ls.length} συνολικά</div></div>
        <div class="tile"><div class="lb">Ραντεβού</div><div class="v">${sNow.rv}</div><div class="d">${sNow.shows} ήρθαν</div></div>
        <div class="tile"><div class="lb">Πωλήσεις</div><div class="v">${sNow.sales}</div><div class="d">${won.length} συνολικά</div></div>
        <div class="tile"><div class="lb">Έσοδα μήνα</div><div class="v">${eur(sNow.revenue)}</div><div class="d">${eur(revAll)} συνολικά</div></div>
        <div class="tile"><div class="lb">Ad spend</div><div class="v ${+c.monthlyBudget && sNow.spend > +c.monthlyBudget ? 'neg' : ''}">${eur(sNow.spend)}</div><div class="d">${+c.monthlyBudget ? Math.round(100 * sNow.spend / +c.monthlyBudget) + '% του budget ' + eur(+c.monthlyBudget) : (sNow.cpl ? 'CPL ' + eur(sNow.cpl) : '—')}</div></div>
        ${(() => { const sp = speedToLead(c.id); return sp ? `<div class="tile"><div class="lb">1η ενέργεια (μ.ό.)</div><div class="v ${sp.avg <= 30 ? 'pos' : sp.avg > 240 ? 'neg' : ''}">${fmtMins(sp.avg)}</div><div class="d">${sp.n} leads · 30 ημέρες</div></div>` : ''; })()}
        <div class="tile"><div class="lb">Κόστος / Lead</div><div class="v">${sNow.cpl ? eur(sNow.cpl) : '—'}</div><div class="d">δαπάνη ÷ ενδιαφερόμενοι</div></div>
        <div class="tile"><div class="lb">Κόστος / Ραντεβού</div><div class="v">${sNow.rv && sNow.spend ? eur(sNow.spend / sNow.rv) : '—'}</div><div class="d">δαπάνη ÷ ραντεβού</div></div>
        <div class="tile"><div class="lb">ROAS</div><div class="v ${sNow.spend > 0 ? (sNow.roas >= 2 ? 'pos' : sNow.roas < 1 ? 'neg' : '') : ''}">${sNow.spend > 0 ? sNow.roas.toFixed(2) + '×' : '—'}</div><div class="d">έσοδα ÷ δαπάνη</div></div>
      </div>
      ${(c.goalLeads || c.goalSales) ? `<div class="card" style="padding:14px 16px;margin-bottom:20px">${goalBar('Leads μήνα', sNow.leads, c.goalLeads)}${goalBar('Πωλήσεις μήνα', sNow.sales, c.goalSales)}</div>` : ''}
      <div class="pill-row">${ls.length ? funnelHTML(ls) : ''}</div>
      ${c.script ? `<div class="scriptbox" style="max-width:640px"><b>Σενάριο κλήσης</b>${esc(c.script)}</div>` : ''}`;
  }
  if (clSub === 'leads') {
    const sorted = [...ls].sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
    body = sorted.length
      ? `<div class="card tablewrap">${leadTableHTML(sorted)}</div>`
      : '<div class="card empty"><div class="big">Κανένα lead ακόμα</div>Σύνδεσε το Google Sheet της κλινικής ή πρόσθεσε χειροκίνητα με «+ Lead».</div>';
  }
  if (clSub === 'calendar') {
    const today = todayISO();
    const upcoming = ls.filter((l) => l.nextAction && l.nextAction >= today && !['won', 'lost'].includes(l.status))
      .sort((a, b) => String(a.nextAction).localeCompare(String(b.nextAction))).slice(0, 30);
    const overdue = ls.filter((l) => l.nextAction && l.nextAction < today && !['won', 'lost'].includes(l.status))
      .sort((a, b) => String(a.nextAction).localeCompare(String(b.nextAction)));
    const row = (l, over) => `<div class="todayrow" data-id="${l.id}">
        <div class="who"><b data-act="open">${esc(l.name)}</b><div class="sub">${esc(l.phone || '')}</div></div>
        <span class="chip ${l.status}">${STATUS[l.status]}</span>
        <span class="due ${over ? 'over' : ''}">${new Date(l.nextAction).toLocaleDateString('el-GR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      </div>`;
    body = `${overdue.length ? `<h3 class="sectionhead" style="margin-top:0">Εκπρόθεσμα <span class="chip lost">${overdue.length}</span></h3><div class="card">${overdue.map((l) => row(l, true)).join('')}</div>` : ''}
      <h3 class="sectionhead">Επερχόμενα ραντεβού &amp; ενέργειες <span class="chip plain">${upcoming.length}</span></h3>
      <div class="card">${upcoming.length ? upcoming.map((l) => row(l, false)).join('') : '<div class="empty">Τίποτα προγραμματισμένο — όρισε «επόμενη ενέργεια» στα leads.</div>'}</div>`;
  }
  if (clSub === 'stats') {
    const stored = S.stats.filter((s) => s.clinicId === c.id && s.month < nowMonth()).sort((a, b) => String(b.month).localeCompare(String(a.month)));
    const cps = S.camps.filter((x) => x.clinicId === c.id).sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
    body = `<div class="filters"><button class="btn small" data-act="clreport">Πλήρης αναφορά μήνα</button><button class="btn small" data-act="clcopyreport">Αντιγραφή για μήνυμα</button></div>
      <div class="card tablewrap section"><table><thead><tr><th>Μήνας</th><th class="num">Leads</th><th class="num">Ραντεβού</th><th class="num">Ήρθαν</th><th class="num">Πωλήσεις</th><th class="num">Έσοδα</th><th class="num">Δαπάνη</th><th class="num">CPL</th><th class="num">€/Ραντ.</th><th class="num">ROAS</th><th class="num">Έσοδα Astra</th><th class="num">Έξοδα</th><th class="num">Αποτέλεσμα</th><th></th></tr></thead><tbody>
        ${statsRow({ ...computeStats(nowMonth(), c) }, true)}${stored.map((s) => statsRow(s, false)).join('')}
      </tbody></table></div>
      <h3 class="sectionhead">Καμπάνιες</h3>
      <div class="card tablewrap">${cps.length ? `<table><thead><tr><th>Καμπάνια</th><th>Μήνας</th><th class="num">Δαπάνη</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Πωλήσεις</th><th class="num">Έσοδα</th><th class="num">ROAS</th></tr></thead><tbody>
        ${cps.map((cp) => {
          const cls = campLeads(cp); const w = cls.filter((l) => l.status === 'won');
          const rev = w.reduce((s, l) => s + (+l.amount || 0), 0);
          const roas = cp.spend > 0 ? rev / cp.spend : 0;
          return `<tr><td><b>${esc(cp.name)}</b></td><td class="mono">${cp.month ? mLabel(cp.month) : '—'}</td><td class="num">${eur(cp.spend)}</td><td class="num">${cls.length}</td><td class="num">${cls.length && cp.spend ? eur(cp.spend / cls.length) : '—'}</td><td class="num">${w.length}</td><td class="num">${eur(rev)}</td><td class="num ${cp.spend > 0 ? (roas >= 2 ? 'pos' : roas < 1 ? 'neg' : '') : ''}">${cp.spend > 0 ? roas.toFixed(2) + '×' : '—'}</td></tr>`;
        }).join('')}</tbody></table>` : '<div class="empty">Καμία καμπάνια για αυτή την κλινική ακόμα.</div>'}</div>`;
  }
  if (clSub === 'crm') {
    const logs = S.clog.filter((x) => x.clinicId === c.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const contacts = Array.isArray(c.contacts) ? c.contacts : [];
    const h = clinicHealth(c);
    body = `
      <div class="card" style="padding:12px 16px;margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <span><span class="hdot ${h.level}"></span> <b>${h.level === 'g' ? 'Υγιής συνεργασία' : h.level === 'y' ? 'Θέλει προσοχή' : 'Κίνδυνος!'}</b></span>
        <span style="color:var(--soft);font-size:12.5px">${esc(h.reasons.join(' · '))}</span>
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;font-size:12.5px">Επόμενη επαφή:
          <input type="date" id="clNextTouch" value="${c.nextTouch || ''}" style="border:1px solid var(--hair);background:var(--card2);border-radius:7px;padding:4px 8px;color:var(--ink)">
        </span>
      </div>
      ${contacts.length ? `<h3 class="sectionhead" style="margin-top:0">Επαφές</h3>
      <div class="card section">${contacts.map((x) => `<div class="contactrow"><b>${esc(x.name)}</b><span class="crole">${esc(x.role)}</span>
        <span class="cmono">${x.phone ? esc(x.phone) + `<button class="copybtn" data-copy="${esc(x.phone)}" title="Αντιγραφή">${COPY_ICON}</button>` : ''}${x.email ? esc(x.email) + `<button class="copybtn" data-copy="${esc(x.email)}" title="Αντιγραφή">${COPY_ICON}</button>` : ''}</span></div>`).join('')}</div>` : ''}
      <h3 class="sectionhead">Ιστορικό επικοινωνίας</h3>
      <div class="card">
        <div class="logform">
          <select id="clLogType">${Object.entries(CLOG_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <input id="clLogBody" placeholder="π.χ. «Κάλεσα τον γιατρό — ΟΚ για αύξηση budget από Νοέμβριο»">
          <button class="btn small primary" data-act="cllogadd">Καταχώρηση</button>
        </div>
        ${logs.length ? logs.slice(0, 40).map((x) => `<div class="clogrow">
          <span class="at">${new Date(x.at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit' })} ${new Date(x.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span>
          <span class="ty">${CLOG_TYPES[x.type] || x.type}</span>
          <span>${esc(x.body)}${x.by ? ` <span style="color:var(--soft)">— ${esc(x.by.split('@')[0])}</span>` : ''}</span>
        </div>`).join('') : '<div class="empty" style="padding:22px">Καμία καταχώρηση — κράτα εδώ κλήσεις, meetings και αποφάσεις με τον πελάτη.</div>'}
      </div>`;
  }
  if (clSub === 'docs') {
    const files = Array.isArray(c.files) ? c.files : [];
    const KIND = { contract: 'Συμφωνητικό', nda: 'NDA', other: 'Άλλο' };
    body = CONFIG.backend !== 'supabase'
      ? '<div class="card empty">Το ανέβασμα εγγράφων είναι διαθέσιμο μόνο σε cloud mode.</div>'
      : `<div class="filters">
          <select id="clDocKind"><option value="contract">Συμφωνητικό</option><option value="nda">NDA</option><option value="other">Άλλο</option></select>
          <button class="btn small primary" data-act="cldocadd">⇪ Ανέβασμα αρχείου</button>
          <span class="fhint">PDF, Word, εικόνες, zip — ορατά μόνο στη συνδεδεμένη ομάδα.</span>
        </div>
        <div class="card">${files.length ? files.map((f, i) => `<div class="trashrow" data-i="${i}" style="padding:10px 14px">
            <span class="srctag">${KIND[f.kind] || 'Άλλο'}</span>
            <span>${esc(f.name)}</span>
            <span class="tmeta">${(f.size / 1024 / 1024).toFixed(1)}MB · ${new Date(f.at).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
            <button class="btn small" data-act="cldocdl">⤓</button>
            <button class="btn small danger" data-act="cldocdel">✕</button>
          </div>`).join('') : '<div class="empty">Κανένα έγγραφο ακόμα. Ανέβασε το συμφωνητικό και τυχόν NDAs.</div>'}</div>`;
  }
  el.innerHTML = head + body;
}
let clDocKind = 'contract';
$('clDocFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  const c = clinicById(currentClinicId);
  if (!file || !c) return;
  if (file.size > 40 * 1024 * 1024) { toast('Μέγιστο μέγεθος 40MB.'); return; }
  const safe = file.name.replace(/[^A-Za-z0-9α-ωΑ-Ωά-ώΆ-Ώ._-]+/g, '_').slice(-80);
  const path = `clinics/${c.id}/${Date.now().toString(36)}_${safe}`;
  toast('Ανέβασμα «' + file.name + '»…');
  try {
    await storageUpload('contracts', path, file);
    const files = [...(Array.isArray(c.files) ? c.files : []), { name: file.name, path, kind: clDocKind, size: file.size, at: new Date().toISOString(), by: userEmail() }];
    await data.update('clinics', c.id, { files });
    await refresh();
    toast('Το αρχείο ανέβηκε ✓');
  } catch (err) { toast(err.message); }
});
$('clinicView').addEventListener('change', async (e) => {
  if (e.target.id === 'clNextTouch') {
    const c = clinicById(currentClinicId); if (!c) return;
    const v = e.target.value || null;
    try {
      await data.update('clinics', c.id, { nextTouch: v });
      await addClientLog(c.id, 'note', v ? 'Ορίστηκε επόμενη επαφή: ' + v : 'Καθαρίστηκε η επόμενη επαφή');
      await refresh();
    } catch (err) { toast('Αποτυχία: ' + err.message); }
    return;
  }
  onLeadRowChange(e);
});
$('clinicView').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'clLogBody') {
    const b = $('clinicView').querySelector('[data-act=cllogadd]');
    if (b) b.click();
  }
});
$('clinicView').addEventListener('click', async (e) => {
  const sub = e.target.closest('[data-clsub]');
  if (sub) { clSub = sub.dataset.clsub; renderClinicView(); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const c = clinicById(currentClinicId);
  const a = act.dataset.act;
  if (a === 'back') { showTab('clinics'); return; }
  if (a === 'open') { const tr = act.closest('[data-id]'); if (tr) openLeadModal(tr.dataset.id); return; }
  if (!c) return;
  if (a === 'clsync') { act.disabled = true; const n = await syncClinic(c, false); act.disabled = false; toast(n ? `Συγχρονίστηκαν ${n} νέα leads.` : 'Κανένα νέο lead.'); }
  if (a === 'cledit') openClinicEdit(c.id);
  if (a === 'clsepa') {
    if (c.sepaStatus === 'active') { toast('Η πάγια εντολή SEPA είναι ενεργή — οι χρεώσεις γίνονται αυτόματα.'); return; }
    act.disabled = true;
    try { toast(await sendMandateLink(c)); await refresh(); }
    catch (err) { const m = String(err.message || ''); toast(m.includes('STRIPE') || m.includes('missing_stripe') ? 'Το Stripe δεν έχει συνδεθεί ακόμα — λείπουν τα κλειδιά.' : m); }
    act.disabled = false;
  }
  if (a === 'clsetup') openObModal(c.id);
  if (a === 'clnewlead') { showTab('leads'); $('leadForm').hidden = false; fillClinicSelect($('lf_clinic')); $('lf_clinic').value = c.id; $('lf_name').focus(); }
  if (a === 'clreport') { showTab('reports'); fillClinicSelect($('rpClinic')); $('rpClinic').value = c.id; renderReport(); }
  if (a === 'clcopyreport') { fillClinicSelect($('rpClinic')); $('rpClinic').value = c.id; $('btnCopyReport').click(); }
  if (a === 'cllogadd') {
    const body = document.getElementById('clLogBody');
    const type = document.getElementById('clLogType');
    if (!body || !body.value.trim()) { toast('Γράψε τι έγινε.'); return; }
    try {
      await addClientLog(c.id, type.value, body.value.trim());
      await refresh();
      toast('Καταχωρήθηκε στο ιστορικό.');
    } catch (err) { toast('Αποτυχία: ' + err.message); }
  }
  if (a === 'cldocadd') { const sel = document.getElementById('clDocKind'); clDocKind = sel ? sel.value : 'contract'; $('clDocFile').click(); }
  if (a === 'cldocdl' || a === 'cldocdel') {
    const row = act.closest('[data-i]'); const f = (c.files || [])[+row.dataset.i]; if (!f) return;
    if (a === 'cldocdl') {
      act.disabled = true;
      try {
        const blob = await storageDownload('contracts', f.path);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = f.name; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      } catch (err) { toast(err.message); }
      act.disabled = false;
    } else {
      if (act.textContent !== 'Σίγουρα;') { act.textContent = 'Σίγουρα;'; setTimeout(() => { act.textContent = '✕'; }, 2500); return; }
      try {
        await storageDelete('contracts', f.path);
        await data.update('clinics', c.id, { files: (c.files || []).filter((x) => x.path !== f.path) });
        await refresh(); toast('Το αρχείο διαγράφηκε.');
      } catch (err) { toast(err.message); }
    }
  }
  if (a === 'recalc') { act.disabled = true; await recomputeMonth(act.closest('tr').dataset.month); }
});

/* ============ LEADS ============ */
$('btnNewLead').onclick = () => {
  if (!S.clinics.length) { toast('Φτιάξε πρώτα μια κλινική.'); showTab('clinics'); return; }
  $('leadForm').hidden = false; fillClinicSelect($('lf_clinic')); $('lf_name').focus();
};
$('btnCancelLead').onclick = () => { $('leadForm').hidden = true; };
$('btnSaveLead').onclick = async () => {
  const name = $('lf_name').value.trim();
  if (!name) { toast('Γράψε όνομα.'); return; }
  const id = 'm' + uid();
  try {
    await data.create('leads', {
      clinicId: $('lf_clinic').value, name, phone: $('lf_phone').value.trim(),
      email: $('lf_email').value.trim(), campaign: $('lf_src').value, adName: '', platform: 'manual',
      createdTime: new Date().toISOString(), status: 'neo', amount: 0, notes: '', sheetNotes: '', source: 'manual',
      importedAt: new Date().toISOString(),
    }, id);
    await logAct(id, 'create', 'Χειροκίνητη καταχώρηση (' + $('lf_src').value + ')');
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  ['lf_name', 'lf_phone', 'lf_email'].forEach((i) => { $(i).value = ''; });
  $('leadForm').hidden = true; toast('Το lead προστέθηκε.');
  await refresh();
};
function fillClinicSelect(sel, withEmpty) {
  const cur = sel.value;
  sel.innerHTML = (withEmpty ? `<option value="">${withEmpty}</option>` : '') + S.clinics.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
['flClinic', 'flStatus', 'flSearch'].forEach((i) => $(i).addEventListener('input', renderLeads));
function funnelHTML(leads) {
  const order = ['neo', 'epik', 'rv', 'show', 'won', 'lost'];
  return order.map((k) => `<span class="chip ${k}">${STATUS[k]} · ${leads.filter((l) => l.status === k).length}</span>`).join('')
    + `<span class="chip plain">Σύνολο ${leads.length}</span>`;
}
function filteredLeads() {
  const fc = $('flClinic').value, fs = $('flStatus').value, q = $('flSearch').value.trim().toLowerCase();
  let ls = [...S.leads];
  if (fc) ls = ls.filter((l) => l.clinicId === fc);
  if (fs) ls = ls.filter((l) => l.status === fs);
  if (q) ls = ls.filter((l) => (l.name + ' ' + l.phone + ' ' + l.email).toLowerCase().includes(q));
  ls.sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
  return ls;
}
let leadView = 'list';
try { leadView = localStorage.getItem('astra-leadview') || 'list'; } catch { /* storage blocked */ }
document.querySelector('.viewtoggle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  leadView = b.dataset.view;
  try { localStorage.setItem('astra-leadview', leadView); } catch { /* storage blocked */ }
  renderLeads();
});
const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);
function dupGroups() {
  const map = {};
  S.leads.forEach((l) => { const ph = normPhone(l.phone); if (ph.length >= 8) (map[ph] = map[ph] || []).push(l); });
  return Object.values(map).filter((g) => g.length > 1);
}
const STATUS_RANK = { neo: 0, lost: 1, epik: 2, rv: 3, show: 4, won: 9 };
async function mergeGroup(g) {
  const sorted = [...g].sort((a, b) => (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
  const primary = sorted[0], dups = sorted.slice(1);
  const patch = {};
  const amt = Math.max(...sorted.map((l) => +l.amount || 0));
  if (amt > (+primary.amount || 0)) patch.amount = amt;
  const notes = sorted.map((l) => l.notes).filter(Boolean).join(' · ');
  if (notes && notes !== primary.notes) patch.notes = notes;
  if (!primary.email) { const e = sorted.find((l) => l.email); if (e) patch.email = e.email; }
  for (const d of dups) {
    for (const a of S.act.filter((x) => x.leadId === d.id)) {
      try { await data.update('activity', a.id, { leadId: primary.id }); } catch { /* δευτερεύον */ }
    }
    await trashRemove('leads', d.id);
  }
  if (Object.keys(patch).length) await data.update('leads', primary.id, patch);
  await logAct(primary.id, 'note', 'Συγχωνεύτηκαν ' + dups.length + ' διπλές εγγραφές (ίδιο τηλέφωνο)');
}
async function mergeAllDups() {
  const groups = dupGroups();
  for (const g of groups) await mergeGroup(g);
  await refresh();
  toast('Συγχωνεύτηκαν ' + groups.length + ' ομάδες διπλών leads.');
}
function renderDupBanner() {
  const groups = dupGroups();
  const el = $('dupBanner');
  el.hidden = !groups.length;
  if (groups.length) {
    el.innerHTML = `<div class="dupbanner"><span>Βρέθηκαν <b>${groups.length}</b> πιθανά διπλά leads (ίδιο τηλέφωνο): ${groups.slice(0, 3).map((g) => esc(g[0].name)).join(', ')}${groups.length > 3 ? '…' : ''}</span><button class="btn small" id="btnMergeDups">Συγχώνευση όλων</button></div>`;
    $('btnMergeDups').onclick = mergeAllDups;
  }
}
function kanbanCard(l) {
  const c = clinicById(l.clinicId);
  const d = l.createdTime ? new Date(l.createdTime) : null;
  return `<div class="kcard" draggable="true" data-id="${l.id}">
    <b>${esc(l.name)}</b>
    <span class="ksub">${esc(c ? c.name : '—')}${d && !isNaN(d) ? ' · ' + d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : ''}</span>
    ${+l.amount ? `<span class="kamt">${eur(+l.amount)}</span>` : ''}
  </div>`;
}
function renderKanban(ls) {
  $('leadKanban').innerHTML = Object.keys(STATUS).map((k) => {
    const col = ls.filter((l) => l.status === k);
    return `<div class="kcol" data-status="${k}">
      <div class="khead"><span class="chip ${k}">${STATUS[k]}</span><span class="mono" style="font-size:12px">${col.length}</span></div>
      ${col.map(kanbanCard).join('')}
    </div>`;
  }).join('');
}
const kb = $('leadKanban');
kb.addEventListener('dragstart', (e) => { const c = e.target.closest('.kcard'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
kb.addEventListener('dragend', (e) => { const c = e.target.closest('.kcard'); if (c) c.classList.remove('dragging'); });
kb.addEventListener('dragover', (e) => { const col = e.target.closest('.kcol'); if (!col) return; e.preventDefault(); col.classList.add('dragover'); });
kb.addEventListener('dragleave', (e) => { const col = e.target.closest('.kcol'); if (col) col.classList.remove('dragover'); });
kb.addEventListener('drop', async (e) => {
  const col = e.target.closest('.kcol'); if (!col) return;
  e.preventDefault(); col.classList.remove('dragover');
  const id = e.dataTransfer.getData('text/plain'); const st = col.dataset.status;
  const l = leadById(id); if (!l || l.status === st) return;
  const patch = { status: st }; if (st === 'won') patch.saleDate = todayISO();
  await updateLead(id, patch, 'status', 'Στάδιο → ' + STATUS[st] + ' (kanban)');
});
kb.addEventListener('click', (e) => { const c = e.target.closest('.kcard'); if (c) openLeadModal(c.dataset.id); });
function renderLeads() {
  fillClinicSelect($('flClinic'), 'Όλες οι κλινικές');
  const ls = filteredLeads();
  const filtered = $('flClinic').value || $('flStatus').value || $('flSearch').value.trim();
  $('leadFunnel').innerHTML = funnelHTML(filtered ? ls : S.leads);
  renderDupBanner();
  document.querySelectorAll('.viewtoggle button').forEach((b) => b.classList.toggle('on', b.dataset.view === leadView));
  $('leadTable').hidden = leadView !== 'list';
  $('leadKanban').hidden = leadView !== 'kanban';
  if (leadView === 'kanban') { renderKanban(ls); return; }
  const el = $('leadTable');
  if (!S.leads.length) {
    el.innerHTML = '<div class="empty"><div class="big">Κανένα lead ακόμα</div>Μόλις συνδέσεις τα Google Sheets στις κλινικές, τα leads θα εμφανίζονται εδώ με ένα κλικ στο «Συγχρονισμός». Μπορείς και χειροκίνητα με «+ Νέο lead».</div>';
    return;
  }
  if (!ls.length) { el.innerHTML = '<div class="empty">Κανένα αποτέλεσμα με αυτά τα φίλτρα.</div>'; return; }
  el.innerHTML = leadTableHTML(ls);
}
const LEAD_THEAD = '<table><thead><tr><th>Ημ/νία</th><th>Όνομα</th><th>Επικοινωνία</th><th>Κλινική</th><th>Καμπάνια</th><th>Στάδιο</th><th>Επόμενη ενέργεια</th><th class="num">Ποσό αγοράς</th></tr></thead><tbody>';
function leadRowHTML(l) {
  const c = clinicById(l.clinicId);
  const d = l.createdTime ? new Date(l.createdTime) : null;
  const dstr = d && !isNaN(d) ? d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : '—';
  const plat = l.platform === 'fb' ? 'FB' : l.platform === 'ig' ? 'IG' : l.platform === 'manual' ? 'χειρ.' : esc(l.platform || '');
  const over = l.nextAction && l.nextAction < todayISO() && !['won', 'lost'].includes(l.status);
  return `<tr data-id="${l.id}">
    <td class="mono" title="${esc(l.createdTime)}">${dstr}</td>
    <td><b data-act="open" style="cursor:pointer">${esc(l.name)}</b>${l.notes ? `<div style="font-size:11.5px;color:var(--soft)">${esc(l.notes)}</div>` : ''}${l.sheetNotes && !l.notes ? `<div style="font-size:11.5px;color:var(--soft)" title="Σημείωση από το sheet"><span class="srctag">sheet</span> ${esc(l.sheetNotes)}</div>` : ''}</td>
    <td class="mono" style="font-size:12.5px">${l.phone ? esc(l.phone) + `<button class="copybtn" data-copy="${esc(l.phone)}" title="Αντιγραφή">${COPY_ICON}</button>` : ''}${l.phone && l.email ? '<br>' : ''}${esc(l.email || '')}</td>
    <td>${esc(c ? c.name : '—')}</td>
    <td style="font-size:12.5px">${esc(l.campaign || '—')}${plat ? ` <span class="chip plain">${plat}</span>` : ''}</td>
    <td><select data-f="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${l.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><input type="date" data-f="nextAction" value="${l.nextAction || ''}" style="${over ? 'color:var(--crit);font-weight:600' : ''}"></td>
    <td class="num">${l.status === 'won' ? `<input class="amt" data-f="amount" value="${l.amount || ''}" placeholder="0" inputmode="decimal">` : (+l.amount ? eur(+l.amount) : '—')}</td>
  </tr>`;
}
function leadTableHTML(ls) { return LEAD_THEAD + ls.map(leadRowHTML).join('') + '</tbody></table>'; }
async function onLeadRowChange(e) {
  const t = e.target, tr = t.closest('tr'); if (!tr) return;
  const id = tr.dataset.id, f = t.dataset.f; if (!f) return;
  try {
    if (f === 'status') {
      const patch = { status: t.value };
      if (t.value === 'won') patch.saleDate = todayISO();
      await updateLead(id, patch, 'status', 'Στάδιο → ' + STATUS[t.value]);
    } else if (f === 'amount') {
      const v = parseNum(t.value);
      await updateLead(id, { amount: v }, 'amount', 'Ποσό αγοράς: ' + eur(v));
    } else if (f === 'nextAction') {
      await updateLead(id, { nextAction: t.value || null }, 'next', t.value ? 'Επόμενη ενέργεια: ' + t.value : 'Καθαρίστηκε');
    }
  } catch (err) { toast('Αποτυχία ενημέρωσης: ' + err.message); }
}
$('leadTable').addEventListener('change', onLeadRowChange);
$('leadTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act=open]');
  if (b) openLeadModal(b.closest('tr').dataset.id);
});
$('btnLeadsCSV').onclick = () => {
  const ls = filteredLeads();
  if (!ls.length) { toast('Δεν υπάρχουν leads για export.'); return; }
  downloadCSV('astra-leads-' + todayISO() + '.csv',
    ['Ημερομηνία', 'Όνομα', 'Τηλέφωνο', 'Email', 'Κλινική', 'Καμπάνια', 'Πλατφόρμα', 'Στάδιο', 'Ποσό', 'Επόμενη ενέργεια', 'Σημειώσεις', 'Σημειώσεις sheet'],
    ls.map((l) => [l.createdTime, l.name, l.phone, l.email, (clinicById(l.clinicId) || {}).name || '', l.campaign, l.platform, STATUS[l.status] || l.status, l.amount || 0, l.nextAction || '', l.notes, l.sheetNotes]));
};
document.body.addEventListener('click', (e) => {
  const b = e.target.closest('.copybtn'); if (!b) return;
  const v = b.dataset.copy;
  try { navigator.clipboard.writeText(v).then(() => toast('Αντιγράφηκε: ' + v)).catch(() => toast(v)); } catch { toast(v); }
});

/* ============ CAMPAIGNS ============ */
$('btnNewCamp').onclick = () => {
  if (!S.clinics.length) { toast('Φτιάξε πρώτα μια κλινική.'); showTab('clinics'); return; }
  $('campForm').hidden = false; fillClinicSelect($('pf_clinic')); $('pf_month').value = nowMonth(); $('pf_name').focus();
};
$('btnCancelCamp').onclick = () => { $('campForm').hidden = true; };
$('btnSaveCamp').onclick = async () => {
  const name = $('pf_name').value.trim();
  if (!name) { toast('Γράψε όνομα καμπάνιας.'); return; }
  try {
    await data.create('campaigns', {
      clinicId: $('pf_clinic').value, name, platform: $('pf_platform').value,
      month: $('pf_month').value || nowMonth(), spend: parseNum($('pf_spend').value),
      impressions: Math.round(parseNum($('pf_impr').value)), clicks: Math.round(parseNum($('pf_clicks').value)),
      createdAt: new Date().toISOString(),
    });
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  ['pf_name', 'pf_spend', 'pf_impr', 'pf_clicks'].forEach((i) => { $(i).value = ''; });
  $('campForm').hidden = true; toast('Η καμπάνια αποθηκεύτηκε.');
  await refresh();
};
['fcClinic', 'fcMonth'].forEach((i) => $(i).addEventListener('input', renderCamps));
const campLeads = (cp) => S.leads.filter((l) => l.clinicId === cp.clinicId && l.campaign && cp.name && l.campaign.trim().toLowerCase() === cp.name.trim().toLowerCase());
function renderCamps() {
  fillClinicSelect($('fcClinic'), 'Όλες οι κλινικές');
  const s = SET();
  $('btnMetaSync').hidden = !(s.metaToken && (s.metaAccount || S.clinics.some((c) => c.metaAdAccount)));
  const months = [...new Set(S.camps.map((c) => c.month).filter(Boolean))].sort().reverse();
  const fm = $('fcMonth'); const cur = fm.value;
  fm.innerHTML = '<option value="">Όλοι οι μήνες</option>' + months.map((m) => `<option value="${m}">${mLabel(m)}</option>`).join('');
  if (cur && months.includes(cur)) fm.value = cur;
  const fc = $('fcClinic').value, fmv = fm.value;
  let cs = [...S.camps];
  if (fc) cs = cs.filter((c) => c.clinicId === fc);
  if (fmv) cs = cs.filter((c) => c.month === fmv);
  cs.sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(a.name).localeCompare(String(b.name)));
  const el = $('campTable');
  if (!S.camps.length) {
    el.innerHTML = '<div class="empty"><div class="big">Καμία καμπάνια ακόμα</div>Καταχώρησε τις καμπάνιες με τη μηνιαία δαπάνη τους — ή σύνδεσε το Meta API στις Ρυθμίσεις για να έρχονται τα νούμερα μόνα τους. Όταν το όνομα ταιριάζει με το campaign_name του Meta, leads, πωλήσεις, CPL και ROAS υπολογίζονται αυτόματα.</div>';
    return;
  }
  if (!cs.length) { el.innerHTML = '<div class="empty">Κανένα αποτέλεσμα με αυτά τα φίλτρα.</div>'; return; }
  const T = { spend: 0, leads: 0, won: 0, rev: 0, impr: 0, clicks: 0 };
  const rows = cs.map((cp) => {
    const ls = campLeads(cp); const won = ls.filter((l) => l.status === 'won');
    const rev = won.reduce((s2, l) => s2 + (+l.amount || 0), 0);
    const cpl = ls.length ? cp.spend / ls.length : 0;
    const roas = cp.spend > 0 ? rev / cp.spend : 0;
    const ctr = cp.impressions > 0 ? 100 * cp.clicks / cp.impressions : 0;
    T.spend += +cp.spend || 0; T.leads += ls.length; T.won += won.length; T.rev += rev; T.impr += +cp.impressions || 0; T.clicks += +cp.clicks || 0;
    const c = clinicById(cp.clinicId);
    const roasCls = cp.spend > 0 ? (roas >= 2 ? 'pos' : roas < 1 ? 'neg' : '') : '';
    return `<tr data-id="${cp.id}">
      <td><b>${esc(cp.name)}</b><div style="font-size:11.5px;color:var(--soft)">${esc(c ? c.name : '—')} · ${esc(cp.platform || '')}</div></td>
      <td class="mono">${cp.month ? mLabel(cp.month) : '—'}</td>
      <td class="num"><input class="amt" data-f="spend" value="${cp.spend || ''}" inputmode="decimal" title="Δαπάνη €"></td>
      <td class="num">${num(cp.impressions)}</td>
      <td class="num">${num(cp.clicks)}${cp.impressions ? `<div style="font-size:10.5px;color:var(--soft)">CTR ${ctr.toFixed(1)}%</div>` : ''}</td>
      <td class="num">${ls.length}</td>
      <td class="num">${ls.length && cp.spend ? eur(cpl) : '—'}</td>
      <td class="num">${won.length}</td>
      <td class="num">${eur(rev)}</td>
      <td class="num ${roasCls}">${cp.spend > 0 ? roas.toFixed(2) + '×' : '—'}</td>
      <td><button class="btn small danger" data-act="delcamp" title="Διαγραφή">✕</button></td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table><thead><tr><th>Καμπάνια</th><th>Μήνας</th><th class="num">Δαπάνη</th><th class="num">Impr.</th><th class="num">Clicks</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Πωλήσεις</th><th class="num">Έσοδα</th><th class="num">ROAS</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>Σύνολο</td><td></td><td class="num">${eur(T.spend)}</td><td class="num">${num(T.impr)}</td><td class="num">${num(T.clicks)}</td><td class="num">${T.leads}</td><td class="num">${T.leads && T.spend ? eur(T.spend / T.leads) : '—'}</td><td class="num">${T.won}</td><td class="num">${eur(T.rev)}</td><td class="num">${T.spend > 0 ? (T.rev / T.spend).toFixed(2) + '×' : '—'}</td><td></td></tr></tfoot></table>`;
}
$('campTable').addEventListener('change', async (e) => {
  const t = e.target, tr = t.closest('tr'); if (!tr || t.dataset.f !== 'spend') return;
  try { await data.update('campaigns', tr.dataset.id, { spend: parseNum(t.value) }); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
let campDel = null;
$('campTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act=delcamp]'); if (!b) return;
  const id = b.closest('tr').dataset.id;
  if (campDel !== id) { campDel = id; b.textContent = 'Σίγουρα;'; setTimeout(() => { campDel = null; renderCamps(); }, 2500); return; }
  campDel = null;
  try { await trashRemove('campaigns', id); toast('Η καμπάνια μπήκε στον κάδο.'); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
async function metaSyncAll(silent) {
  const s = SET();
  const mk = nowMonth();
  let updated = 0, created = 0, errs = [];
  // Ανά κλινική με δικό της ad account· fallback στο γενικό account των Ρυθμίσεων
  const targets = S.clinics.filter((c) => c.metaAdAccount).map((c) => ({ account: c.metaAdAccount, clinicId: c.id, name: c.name }));
  if (!targets.length && s.metaAccount) targets.push({ account: s.metaAccount, clinicId: null, name: 'γενικό' });
  {
    for (const t of targets) {
      let ins;
      try { ins = await metaInsights(s.metaToken, t.account); }
      catch (e) { errs.push(t.name + ': ' + e.message); continue; }
      for (const hit of ins) {
        const cp = S.camps.find((c) => c.month === mk
          && (t.clinicId ? c.clinicId === t.clinicId : true)
          && c.name.trim().toLowerCase() === hit.name.trim().toLowerCase());
        if (cp) {
          await data.update('campaigns', cp.id, { spend: hit.spend, impressions: hit.impressions, clicks: hit.clicks });
          updated++;
        } else if (t.clinicId && (hit.spend > 0 || hit.impressions > 0)) {
          await data.create('campaigns', {
            clinicId: t.clinicId, name: hit.name, platform: 'Meta', month: mk,
            spend: hit.spend, impressions: hit.impressions, clicks: hit.clicks,
            createdAt: new Date().toISOString(),
          });
          created++;
        }
      }
    }
  }
  await refresh();
  return { created, updated, errs };
}
$('btnMetaSync').onclick = async () => {
  const b = $('btnMetaSync');
  b.disabled = true; b.textContent = 'Meta sync…';
  try {
    const r = await metaSyncAll(false);
    const parts = [];
    if (r.created) parts.push(r.created + ' νέες καμπάνιες από το Meta');
    if (r.updated) parts.push(r.updated + ' ενημερώθηκαν');
    toast(parts.length ? parts.join(' · ') + ' ✓' : (r.errs[0] || 'Τίποτα προς συγχρονισμό — βάλε Meta Ad Account στις κλινικές.'));
  } catch (e) { toast(e.message); }
  b.disabled = false; b.textContent = '⟳ Meta sync';
};

/* ============ CREATIVES ============ */
$('btnNewCr').onclick = () => {
  if (!S.clinics.length) { toast('Φτιάξε πρώτα μια κλινική.'); showTab('clinics'); return; }
  $('crForm').hidden = false; fillClinicSelect($('cr_clinic')); $('cr_name').focus();
};
$('btnCancelCr').onclick = () => { $('crForm').hidden = true; };
$('btnSaveCr').onclick = async () => {
  const name = $('cr_name').value.trim();
  if (!name) { toast('Γράψε όνομα δημιουργικού.'); return; }
  try {
    await data.create('creatives', {
      clinicId: $('cr_clinic').value, name, adName: $('cr_adname').value.trim(),
      url: $('cr_url').value.trim(), perf: '', notes: $('cr_notes').value.trim(),
      createdAt: new Date().toISOString(),
    }, 'c' + uid());
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  ['cr_name', 'cr_adname', 'cr_url', 'cr_notes'].forEach((i) => { $(i).value = ''; });
  $('crForm').hidden = true; toast('Το δημιουργικό αποθηκεύτηκε.');
  await refresh();
};
const PERF = { '': '—', top: '🔥 Δουλεύει', ok: '😐 Μέτριο', bad: '❌ Κακό' };
const creativeLeads = (cr) => (cr.adName ? S.leads.filter((l) => l.clinicId === cr.clinicId && l.adName && l.adName.trim().toLowerCase() === cr.adName.trim().toLowerCase()) : []);
let crDel = null;
function renderCreatives() {
  const fc = $('fcClinic').value;
  let list = [...S.cr];
  if (fc) list = list.filter((c) => c.clinicId === fc);
  const el = $('crTable');
  if (!S.cr.length) { el.innerHTML = '<div class="empty">Κανένα δημιουργικό ακόμα. Κράτα εδώ τα creatives κάθε κλινικής με link και ad_name — τα leads μετριούνται μόνα τους.</div>'; return; }
  if (!list.length) { el.innerHTML = '<div class="empty">Κανένα δημιουργικό για αυτή την κλινική.</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Δημιουργικό</th><th>Κλινική</th><th>ad_name</th><th class="num">Leads</th><th class="num">Πωλήσεις</th><th>Απόδοση</th><th>Link</th><th>Σημειώσεις</th><th></th></tr></thead><tbody>'
    + list.map((cr) => {
      const ls = creativeLeads(cr);
      const won = ls.filter((l) => l.status === 'won').length;
      const c = clinicById(cr.clinicId);
      return `<tr data-id="${cr.id}">
      <td><b>${esc(cr.name)}</b></td>
      <td>${esc(c ? c.name : '—')}</td>
      <td class="mono" style="font-size:12px">${esc(cr.adName || '—')}</td>
      <td class="num">${cr.adName ? ls.length : '—'}</td>
      <td class="num">${cr.adName ? won : '—'}</td>
      <td><select data-f="perf">${Object.entries(PERF).map(([k, v]) => `<option value="${k}"${cr.perf === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
      <td>${cr.url ? `<a href="${esc(cr.url)}" target="_blank" rel="noopener">άνοιγμα ↗</a>` : '—'}</td>
      <td style="font-size:12.5px;color:var(--soft)">${esc(cr.notes || '')}</td>
      <td><button class="btn small danger" data-act="delcr">✕</button></td></tr>`;
    }).join('') + '</tbody></table>';
}
$('crTable').addEventListener('change', async (e) => {
  const t = e.target, tr = t.closest('tr'); if (!tr || t.dataset.f !== 'perf') return;
  try { await data.update('creatives', tr.dataset.id, { perf: t.value }); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
$('crTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act=delcr]'); if (!b) return;
  const id = b.closest('tr').dataset.id;
  if (crDel !== id) { crDel = id; b.textContent = 'Σίγουρα;'; setTimeout(() => { crDel = null; renderCreatives(); }, 2500); return; }
  crDel = null;
  try { await trashRemove('creatives', id); toast('Μπήκε στον κάδο.'); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});

/* ============ FINANCE ============ */
function finMonths() {
  const ms = new Set([nowMonth()]);
  S.fin.forEach((f) => { const m = monthKey(f.date); if (m) ms.add(m); });
  return [...ms].sort().reverse();
}
$('btnNewFin').onclick = () => {
  $('finForm').hidden = false; $('ff_date').value = todayISO();
  $('ff_fileWrap').hidden = CONFIG.backend !== 'supabase'; $('ff_file').value = '';
  fillFinCats(); fillClinicSelect($('ff_clinic'), '—'); updGross(); $('ff_net').focus();
};
$('btnCancelFin').onclick = () => { $('finForm').hidden = true; };
function fillFinCats() { const k = $('ff_kind').value; $('ff_cat').innerHTML = CATS[k].map((c) => `<option>${c}</option>`).join(''); }
$('ff_kind').addEventListener('change', fillFinCats);
function updGross() { const n = parseNum($('ff_net').value), v = +$('ff_vat').value; $('ff_gross').textContent = n ? eur(n * (1 + v / 100)) : '—'; }
$('ff_net').addEventListener('input', updGross);
$('ff_vat').addEventListener('change', updGross);
$('btnSaveFin').onclick = async () => {
  const net = parseNum($('ff_net').value);
  if (!net) { toast('Γράψε καθαρό ποσό.'); return; }
  const vatRate = +$('ff_vat').value;
  const file = $('ff_file').files[0];
  let row;
  try {
    row = await data.create('finance', {
      kind: $('ff_kind').value, date: $('ff_date').value || todayISO(),
      category: $('ff_cat').value, clinicId: $('ff_clinic').value || null, description: $('ff_desc').value.trim(),
      net, vatRate, vat: +(net * vatRate / 100).toFixed(2), gross: +(net * (1 + vatRate / 100)).toFixed(2),
    });
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  $('ff_net').value = ''; $('ff_desc').value = ''; $('ff_file').value = ''; updGross();
  $('finForm').hidden = true;
  let msg = 'Η εγγραφή αποθηκεύτηκε.';
  if (file) {
    toast('Η εγγραφή αποθηκεύτηκε — ανεβαίνει το παραστατικό…');
    try { await attachReceipt(row, file); msg = 'Η εγγραφή αποθηκεύτηκε με το παραστατικό της ✓'; }
    catch (e) { msg = 'Η εγγραφή αποθηκεύτηκε, αλλά το παραστατικό δεν ανέβηκε: ' + e.message; }
  }
  toast(msg);
  await refresh();
};
/* Ανεβάζει το παραστατικό στο Drive (φάκελος του μήνα της εγγραφής), το δένει με την εγγραφή
   και το προσθέτει στη λίστα αποδείξεων του μήνα. */
async function attachReceipt(f, file) {
  if (file.size > 40 * 1024 * 1024) throw new Error('Μέγιστο μέγεθος 40MB.');
  const m = monthKey(f.date);
  const up = await uploadReceipt(gcalClient(), m, file);
  await data.update('finance', f.id, { receiptLink: up.link, receiptId: up.id });
  await saveAcctFiles(m, [...acctFiles(m), { name: file.name, driveId: up.id, link: up.link, folderId: up.folderId, size: file.size, at: new Date().toISOString(), by: userEmail(), finId: f.id }]);
}
let finRcId = null;
$('finRcFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  const f = S.fin.find((x) => x.id === finRcId);
  if (!file || !f) return;
  toast('Ανέβασμα «' + file.name + '»…');
  try { await attachReceipt(f, file); await refresh(); toast('Το παραστατικό δέθηκε με την εγγραφή ✓'); }
  catch (err) { toast(err.message); }
});
['fqMonth', 'ffKindFilter'].forEach((i) => $(i).addEventListener('input', renderFin));
let finDel = null;
function monthRows(mk) { return S.fin.filter((f) => monthKey(f.date) === mk); }
function renderFin() {
  const fq = $('fqMonth'); const opts = finMonths(); const cur = fq.value;
  fq.innerHTML = opts.map((m) => `<option value="${m}">${mLabel(m)}</option>`).join('');
  fq.value = cur && opts.includes(cur) ? cur : nowMonth();
  const mk = fq.value;
  const inQ = monthRows(mk);
  const inc = inQ.filter((f) => f.kind === 'income'), exp = inQ.filter((f) => f.kind === 'expense');
  const sum = (a, k) => a.reduce((s, f) => s + (+f[k] || 0), 0);
  const vatOut = sum(inc, 'vat'), vatIn = sum(exp, 'vat'), vatDue = vatOut - vatIn;
  const cloud = CONFIG.backend === 'supabase';
  const noRc = exp.filter((f) => !driveLink(f.receiptLink)).length;
  $('finTiles').innerHTML = `
    <div class="tile"><div class="lb">Έσοδα (καθαρά)</div><div class="v">${eur(sum(inc, 'net'))}</div><div class="d">${inc.length} εγγραφές</div></div>
    <div class="tile"><div class="lb">Έξοδα (καθαρά)</div><div class="v">${eur(sum(exp, 'net'))}</div><div class="d">${exp.length} εγγραφές${cloud && noRc ? ` · <span class="neg">${noRc} χωρίς παραστατικό</span>` : ''}</div></div>
    <div class="tile"><div class="lb">Αποτέλεσμα</div><div class="v ${sum(inc, 'net') - sum(exp, 'net') >= 0 ? 'pos' : 'neg'}">${eur(sum(inc, 'net') - sum(exp, 'net'))}</div><div class="d">προ φόρων</div></div>
    <div class="tile"><div class="lb">ΦΠΑ εκροών − εισροών</div><div class="v ${vatDue > 0 ? 'neg' : 'pos'}">${eur(vatDue)}</div><div class="d">${vatDue > 0 ? 'για απόδοση' : 'πιστωτικό'} τον μήνα</div></div>`;
  const kf = $('ffKindFilter').value;
  let rows = inQ; if (kf) rows = rows.filter((f) => f.kind === kf);
  rows = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const el = $('finTable');
  if (!S.fin.length) {
    el.innerHTML = '<div class="empty"><div class="big">Καμία εγγραφή ακόμα</div>Καταχώρησε έσοδα (αμοιβές κλινικών) και έξοδα με τον ΦΠΑ τους — ο μήνας κλείνει μόνος του: σύνολα, αποτέλεσμα και ΦΠΑ για απόδοση. Οι σταθερές χρεώσεις μπαίνουν μία φορά στις «Πάγιες εγγραφές».</div>';
  } else if (!rows.length) {
    el.innerHTML = '<div class="empty">Καμία εγγραφή σε αυτόν τον μήνα.</div>';
  } else {
    el.innerHTML = '<table><thead><tr><th>Ημ/νία</th><th>Τύπος</th><th>Κατηγορία</th><th>Περιγραφή</th><th>Κλινική</th><th class="num">Καθαρό</th><th class="num">ΦΠΑ</th><th class="num">Μικτό</th>' + (cloud ? '<th>Παραστατικό</th>' : '') + '<th></th></tr></thead><tbody>'
      + rows.map((f) => {
        const c = clinicById(f.clinicId);
        const rc = !cloud ? '' : '<td>' + (driveLink(f.receiptLink)
          ? `<a class="btn small" style="text-decoration:none" href="${esc(f.receiptLink)}" target="_blank" rel="noopener" title="Άνοιγμα στο Drive">📎 Άνοιγμα</a>`
          : `<button class="btn small" data-act="attfin" title="Ανέβασε φωτογραφία ή PDF">⇪ ${f.kind === 'expense' ? '<span class="neg">Λείπει</span>' : 'Προσθήκη'}</button>`) + '</td>';
        return `<tr data-id="${f.id}">
        <td class="mono">${new Date(f.date).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
        <td><span class="chip ${f.kind === 'income' ? 'won' : 'lost'}">${f.kind === 'income' ? 'Έσοδο' : 'Έξοδο'}</span>${f.recurringId ? ' <span class="chip plain" title="Από πάγια εγγραφή">↻</span>' : ''}</td>
        <td>${esc(f.category || '')}</td><td>${esc(f.description || '')}</td><td>${esc(c ? c.name : '')}</td>
        <td class="num">${eur(f.net)}</td><td class="num" title="${f.vatRate}%">${eur(f.vat)}</td><td class="num"><b>${eur(f.gross)}</b></td>${rc}
        <td><button class="btn small danger" data-act="delfin">✕</button></td></tr>`;
      }).join('') + '</tbody></table>';
  }
  renderTaxTiles();
  renderWeeks();
  renderBilling();
  renderRecurring();
  renderSubs();
  renderAccountant();
  renderCashflow();
  renderProfit();
  renderExpChart();
}
$('finTable').addEventListener('click', async (e) => {
  const at = e.target.closest('button[data-act=attfin]');
  if (at) { finRcId = at.closest('tr').dataset.id; $('finRcFile').click(); return; }
  const b = e.target.closest('button[data-act=delfin]'); if (!b) return;
  const id = b.closest('tr').dataset.id;
  if (finDel !== id) { finDel = id; b.textContent = 'Σίγουρα;'; setTimeout(() => { finDel = null; renderFin(); }, 2500); return; }
  finDel = null;
  try { await trashRemove('finance', id); toast('Η εγγραφή μπήκε στον κάδο.'); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
$('btnFinCSV').onclick = () => {
  const mk = $('fqMonth').value || nowMonth();
  const rows = monthRows(mk);
  if (!rows.length) { toast('Καμία εγγραφή στον μήνα.'); return; }
  downloadCSV('astra-oikonomika-' + mk + '.csv',
    ['Ημερομηνία', 'Τύπος', 'Κατηγορία', 'Περιγραφή', 'Κλινική', 'Καθαρό', 'ΦΠΑ %', 'ΦΠΑ', 'Μικτό'],
    rows.map((f) => [f.date, f.kind === 'income' ? 'Έσοδο' : 'Έξοδο', f.category, f.description, (clinicById(f.clinicId) || {}).name || '', f.net, f.vatRate, f.vat, f.gross]));
};

/* ---- πάγιες εγγραφές ---- */
$('btnNewRec').onclick = () => {
  $('recForm').hidden = false;
  fillRecCats(); fillClinicSelect($('rf_clinic'), '—'); $('rf_net').focus();
};
$('btnCancelRec').onclick = () => { $('recForm').hidden = true; };
function fillRecCats() { const k = $('rf_kind').value; $('rf_cat').innerHTML = CATS[k].map((c) => `<option>${c}</option>`).join(''); }
$('rf_kind').addEventListener('change', fillRecCats);
$('btnSaveRec').onclick = async () => {
  const net = parseNum($('rf_net').value);
  if (!net) { toast('Γράψε καθαρό ποσό.'); return; }
  try {
    await data.create('recurring', {
      kind: $('rf_kind').value, category: $('rf_cat').value, description: $('rf_desc').value.trim(),
      clinicId: $('rf_clinic').value || null, net, vatRate: +$('rf_vat').value,
      day: Math.min(28, Math.max(1, Math.round(parseNum($('rf_day').value)) || 1)),
      active: true, createdAt: new Date().toISOString(),
    });
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  $('rf_net').value = ''; $('rf_desc').value = '';
  $('recForm').hidden = true; toast('Η πάγια εγγραφή αποθηκεύτηκε — θα καταχωρείται κάθε μήνα.');
  await refresh();
  await materializeRecurring();
};
let recDel = null;
function renderRecurring() {
  const el = $('recTable');
  if (!S.rec.length) { el.innerHTML = '<div class="empty">Καμία πάγια εγγραφή. Βάλε εδώ ό,τι επαναλαμβάνεται κάθε μήνα (αμοιβές πελατών, συνδρομές, ενοίκιο) και θα καταχωρείται μόνο του.</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Τύπος</th><th>Κατηγορία</th><th>Περιγραφή</th><th>Κλινική</th><th class="num">Καθαρό</th><th class="num">ΦΠΑ</th><th class="num">Ημέρα</th><th>Ενεργή</th><th></th></tr></thead><tbody>'
    + S.rec.map((r) => {
      const c = clinicById(r.clinicId);
      return `<tr data-id="${r.id}">
      <td><span class="chip ${r.kind === 'income' ? 'won' : 'lost'}">${r.kind === 'income' ? 'Έσοδο' : 'Έξοδο'}</span></td>
      <td>${esc(r.category || '')}</td><td>${esc(r.description || '')}</td><td>${esc(c ? c.name : '')}</td>
      <td class="num">${eur(r.net)}</td><td class="num">${r.vatRate}%</td><td class="num">${r.day}</td>
      <td><input type="checkbox" data-f="active"${r.active ? ' checked' : ''}></td>
      <td><button class="btn small danger" data-act="delrec">✕</button></td></tr>`;
    }).join('') + '</tbody></table>';
}
$('recTable').addEventListener('change', async (e) => {
  const t = e.target, tr = t.closest('tr'); if (!tr || t.dataset.f !== 'active') return;
  try { await data.update('recurring', tr.dataset.id, { active: t.checked }); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
$('recTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act=delrec]'); if (!b) return;
  const id = b.closest('tr').dataset.id;
  if (recDel !== id) { recDel = id; b.textContent = 'Σίγουρα;'; setTimeout(() => { recDel = null; renderRecurring(); }, 2500); return; }
  recDel = null;
  try { await trashRemove('recurring', id); toast('Η πάγια εγγραφή μπήκε στον κάδο.'); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
/* ---- ετήσιες συνδρομές πελατών: υπενθύμιση 30 μέρες πριν την ανανέωση ---- */
const SUB_WARN_DAYS = 30;
const subName = (s) => (clinicById(s.clinicId) || {}).name || s.clientName || '—';
const subDays = (s) => Math.round((new Date(s.renewDate + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 86400000);
const subsDue = () => S.subs.filter((s) => subDays(s) <= SUB_WARN_DAYS).sort((a, b) => String(a.renewDate).localeCompare(String(b.renewDate)));
function subWhen(s) {
  const d = subDays(s);
  const dt = new Date(s.renewDate + 'T12:00:00').toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: '2-digit' });
  return dt + (d < 0 ? ` · πριν ${-d}μ` : d === 0 ? ' · σήμερα' : d <= SUB_WARN_DAYS ? ` · σε ${d}μ` : '');
}
function plusYear(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y + 1, m - 1, Math.min(d, new Date(y + 1, m, 0).getDate()), 12));
}
let editSubId = null;
function openSubForm(s) {
  editSubId = s ? s.id : null;
  $('subFormTitle').textContent = s ? 'Επεξεργασία συνδρομής' : 'Νέα ετήσια συνδρομή';
  fillClinicSelect($('sf_clinic'), '—');
  $('sf_clinic').value = (s && s.clinicId) || '';
  $('sf_client').value = s ? s.clientName || '' : '';
  $('sf_desc').value = s ? s.description || '' : '';
  $('sf_net').value = s && +s.net ? s.net : '';
  $('sf_vat').value = String(s ? s.vatRate ?? 24 : 24);
  $('sf_date').value = s ? s.renewDate : '';
  $('sf_notes').value = s ? s.notes || '' : '';
  $('subForm').hidden = false;
  $('subForm').scrollIntoView({ block: 'center' });
}
$('btnNewSub').onclick = () => openSubForm(null);
$('btnCancelSub').onclick = () => { $('subForm').hidden = true; editSubId = null; };
$('btnSaveSub').onclick = async () => {
  const clinicId = $('sf_clinic').value || null, clientName = $('sf_client').value.trim();
  if (!clinicId && !clientName) { toast('Διάλεξε κλινική ή γράψε όνομα πελάτη.'); return; }
  if (!$('sf_date').value) { toast('Βάλε ημερομηνία επόμενης ανανέωσης.'); return; }
  const body = {
    clinicId, clientName, description: $('sf_desc').value.trim(),
    net: parseNum($('sf_net').value), vatRate: +$('sf_vat').value,
    renewDate: $('sf_date').value, notes: $('sf_notes').value.trim(),
  };
  try {
    if (editSubId) await data.update('subscriptions', editSubId, body);
    else await data.create('subscriptions', { ...body, createdAt: new Date().toISOString() });
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); return; }
  $('subForm').hidden = true; editSubId = null;
  toast('Η συνδρομή αποθηκεύτηκε — θα σου το θυμίσω ' + SUB_WARN_DAYS + ' μέρες πριν.');
  await refresh();
};
/* Ανανέωση: καταχωρεί το έσοδο (αν υπάρχει ποσό) και πάει την ημερομηνία έναν χρόνο μετά. */
async function renewSub(id) {
  const s = S.subs.find((x) => x.id === id); if (!s) return;
  const net = +s.net || 0, vr = +s.vatRate || 0, next = plusYear(s.renewDate);
  try {
    if (net) {
      await data.create('finance', {
        kind: 'income', date: todayISO(), category: 'Αμοιβή διαχείρισης', clinicId: s.clinicId || null,
        description: 'Ετήσια συνδρομή · ' + subName(s) + (s.description ? ' · ' + s.description : ''),
        net, vatRate: vr, vat: +(net * vr / 100).toFixed(2), gross: +(net * (1 + vr / 100)).toFixed(2),
      });
    }
    await data.update('subscriptions', id, { renewDate: next, lastRenewed: todayISO() });
    toast(`Ανανεώθηκε έως ${new Date(next + 'T12:00:00').toLocaleDateString('el-GR')}` + (net ? ` — καταχωρήθηκε έσοδο ${eur(net)}.` : '.'));
    await refresh();
  } catch (err) { toast('Αποτυχία: ' + err.message); }
}
let subDel = null;
function renderSubs() {
  const el = $('subTable');
  if (!S.subs.length) { el.innerHTML = '<div class="empty">Καμία ετήσια συνδρομή. Πρόσθεσε όσους πελάτες πληρώνουν μία φορά τον χρόνο και θα στο θυμίζω πριν την ανανέωση.</div>'; return; }
  const total = S.subs.reduce((t, s) => t + (+s.net || 0), 0);
  el.innerHTML = '<table><thead><tr><th>Πελάτης</th><th>Περιγραφή</th><th class="num">Καθαρό</th><th class="num">Με ΦΠΑ</th><th>Επόμενη ανανέωση</th><th>Σημειώσεις</th><th></th></tr></thead><tbody>'
    + [...S.subs].sort((a, b) => String(a.renewDate).localeCompare(String(b.renewDate))).map((s) => {
      const d = subDays(s), net = +s.net || 0;
      return `<tr data-id="${s.id}">
      <td><b>${esc(subName(s))}</b></td><td>${esc(s.description || '')}</td>
      <td class="num">${net ? eur(net) : '—'}</td><td class="num">${net ? eur(+(net * (1 + (+s.vatRate || 0) / 100)).toFixed(2)) : '—'}</td>
      <td><span class="chip ${d < 0 ? 'lost' : d <= SUB_WARN_DAYS ? 'epik' : 'plain'}">${subWhen(s)}</span></td>
      <td>${esc(s.notes || '')}</td>
      <td style="white-space:nowrap"><button class="btn small" data-act="renewsub" title="Καταχωρεί το έσοδο και μεταθέτει την ανανέωση +1 χρόνο">✓ Ανανεώθηκε</button>
        <button class="btn small" data-act="editsub" title="Επεξεργασία">✎</button>
        <button class="btn small danger" data-act="delsub">✕</button></td></tr>`;
    }).join('')
    + `</tbody><tfoot><tr><td colspan="2"><b>Σύνολο ανά έτος</b></td><td class="num"><b>${eur(total)}</b></td><td colspan="4"></td></tr></tfoot></table>`;
}
$('subTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('tr').dataset.id, act = b.dataset.act;
  if (act === 'editsub') { openSubForm(S.subs.find((s) => s.id === id)); return; }
  if (act === 'renewsub') { b.disabled = true; await renewSub(id); return; }
  if (subDel !== id) { subDel = id; b.textContent = 'Σίγουρα;'; setTimeout(() => { subDel = null; renderSubs(); }, 2500); return; }
  subDel = null;
  try { await trashRemove('subscriptions', id); toast('Η συνδρομή μπήκε στον κάδο.'); await refresh(); }
  catch (err) { toast('Αποτυχία: ' + err.message); }
});
/* Καταχωρεί τις πάγιες του τρέχοντος μήνα, μία φορά η καθεμία. */
async function materializeRecurring() {
  const mk = nowMonth();
  const [y, m] = mk.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  let made = 0;
  for (const r of S.rec.filter((x) => x.active)) {
    if (S.fin.some((f) => f.recurringId === r.id && f.month === mk)) continue;
    const day = Math.min(r.day || 1, lastDay);
    const net = +r.net || 0;
    try {
      await data.create('finance', {
        kind: r.kind, date: `${mk}-${String(day).padStart(2, '0')}`,
        category: r.category, clinicId: r.clinicId || null,
        description: (r.description || r.category) + ' · ' + mLabel(mk),
        net, vatRate: r.vatRate, vat: +(net * r.vatRate / 100).toFixed(2), gross: +(net * (1 + r.vatRate / 100)).toFixed(2),
        recurringId: r.id, month: mk,
      });
      made++;
    } catch { /* θα ξαναδοκιμάσει στο επόμενο άνοιγμα */ }
  }
  if (made) { toast(`Καταχωρήθηκαν ${made} πάγιες εγγραφές για ${mLabel(mk)}.`); await refresh(); }
}

/* ---- Φορολογία: ΦΠΑ μήνα + φόρος 22% έτους + προκαταβολή ---- */
/* Μοντέλο εσόδων Astra: 50€ (ρυθμιζόμενο) ανά πληρωμένο ραντεβού — υπολογίζεται
   αυτόματα από τα leads που έφτασαν σε ραντεβού (rv/show/won), όχι από χειροκίνητες εγγραφές. */
const apptFee = () => +SET().appointmentFee || 50;
const isBooked = (l) => ['rv', 'show', 'won'].includes(l.status);
function taxEstimate() {
  const mk = nowMonth();
  const year = mk.slice(0, 4);
  const inYear = (f) => String(f.date || '').startsWith(year);
  const inMonth = (f) => monthKey(f.date) === mk;
  const sum = (rows, k) => rows.reduce((s, f) => s + (+f[k] || 0), 0);
  const notBilling = (f) => f.category !== 'Χρέωση ραντεβού';
  const incM = S.fin.filter((f) => f.kind === 'income' && inMonth(f) && notBilling(f));
  const expM = S.fin.filter((f) => f.kind === 'expense' && inMonth(f));
  const incY = S.fin.filter((f) => f.kind === 'income' && inYear(f) && notBilling(f));
  const expY = S.fin.filter((f) => f.kind === 'expense' && inYear(f));
  // Πληρωμένα ραντεβού από leads που ήρθαν τον μήνα / τη χρονιά
  const apptM = S.leads.filter((l) => isBooked(l) && monthKey(l.createdTime) === mk).length;
  const apptY = S.leads.filter((l) => isBooked(l) && String(l.createdTime || '').startsWith(year)).length;
  const revM = apptM * apptFee() + sum(incM, 'net');      // τζίρος μήνα
  const revY = apptY * apptFee() + sum(incY, 'net');
  const expMn = sum(expM, 'net'), expYn = sum(expY, 'net');
  const profitM = revM - expMn;                            // ξεκινά αρνητικό από τα πάγια
  const profitY = revY - expYn;
  // ΦΠΑ: 24% πάνω στα τιμολόγια ραντεβού + χειροκίνητα έσοδα − εισροές
  const vatMonth = apptM * apptFee() * 0.24 + sum(incM, 'vat') - sum(expM, 'vat');
  const tax = Math.max(0, profitY) * 0.22;
  const prepayPct = +SET().taxPrepayPct || 80;             // ΙΚΕ: 80%
  const prepay = tax * prepayPct / 100;
  return { mk, year, apptM, apptY, revM, revY, expMn, profitM, vatMonth, profitY, incY: revY, expY: expYn, tax, prepay, prepayPct, total: tax + prepay };
}
function renderTaxTiles() {
  const t = taxEstimate();
  $('finTaxTiles').innerHTML = `
    <div class="tile"><div class="lb">Τζίρος ${mLabel(t.mk)}</div><div class="v">${eur(t.revM)}</div><div class="d">${t.apptM} ραντεβού × ${eur(apptFee())}</div></div>
    ${(() => {
      const be = Math.ceil(t.expMn / apptFee());
      const day = new Date().getDate();
      const dim = new Date(+t.year, +t.mk.slice(5, 7), 0).getDate();
      const proj = Math.round(t.apptM / Math.max(1, day) * dim);
      const projProfit = proj * apptFee() + (t.revM - t.apptM * apptFee()) - t.expMn;
      return `<div class="tile"><div class="lb">Κέρδος ${mLabel(t.mk)}</div><div class="v ${t.profitM >= 0 ? 'pos' : 'neg'}">${eur(t.profitM)}</div><div class="d">${t.apptM >= be ? 'πάνω από το νεκρό σημείο (' + be + ' ραντ.)' : 'νεκρό σημείο ' + be + ' ραντ. — λείπουν ' + (be - t.apptM)} · πρόβλεψη μήνα ~${proj} ραντ. / ${eur(projProfit)}</div></div>`;
    })()}
    <div class="tile"><div class="lb">ΦΠΑ ${mLabel(t.mk)}</div><div class="v ${t.vatMonth > 0 ? 'neg' : 'pos'}">${eur(t.vatMonth)}</div><div class="d">${t.vatMonth > 0 ? 'για απόδοση στο τέλος του μήνα' : 'πιστωτικό υπόλοιπο'}</div></div>
    <div class="tile"><div class="lb">Κέρδος ${t.year}</div><div class="v ${t.profitY >= 0 ? '' : 'neg'}">${eur(t.profitY)}</div><div class="d">${t.apptY} ραντεβού έτους · έξοδα ${eur(t.expY)}</div></div>
    <div class="tile"><div class="lb">Φόρος 22% (ΙΚΕ) · τέλος ${t.year}</div><div class="v">${eur(t.tax)}</div><div class="d">22% στο κέρδος έτους</div></div>
    <div class="tile"><div class="lb">Προκαταβολή ${+t.year + 1}</div><div class="v">${eur(t.prepay)}</div><div class="d">${t.prepayPct}% του φόρου (ΙΚΕ)</div></div>
    <div class="tile"><div class="lb">Σύνολο εκκαθάρισης</div><div class="v neg">${eur(t.total)}</div><div class="d">βάλε στην άκρη ~${eur(t.total / Math.max(1, +t.mk.slice(5, 7)))} / μήνα</div></div>`;
}

/* ---- Εβδομαδιαίες χρεώσεις SEPA (Δευτέρα–Κυριακή) ---- */
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function weekStartOf(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekRange(startIso) { const s = new Date(startIso + 'T12:00:00'); const e = new Date(s); e.setDate(s.getDate() + 6); return { start: startIso, end: isoDate(e) }; }
function lastWeeks(n) { const out = []; const s = weekStartOf(new Date()); s.setDate(s.getDate() - 7); for (let i = 0; i < n; i++) { out.push(isoDate(s)); s.setDate(s.getDate() - 7); } return out; }
const wkLabel = (startIso) => { const r = weekRange(startIso); const f = (x) => new Date(x + 'T12:00:00').toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }); return f(r.start) + ' – ' + f(r.end); };
function weekLeads(clinicId, startIso) {
  const r = weekRange(startIso);
  return S.leads.filter((l) => l.clinicId === clinicId && isBooked(l) && l.createdTime && String(l.createdTime).slice(0, 10) >= r.start && String(l.createdTime).slice(0, 10) <= r.end)
    .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
}
/* Μοντέλο «ποσοστό επί πωλήσεων»: πωλήσεις της εβδομάδας (ημερομηνία πώλησης) × καθαρό ποσό × ποσοστό. */
const isShare = (c) => (c.billingModel || 'appointment') === 'share';
function weekSales(clinicId, startIso) {
  const r = weekRange(startIso);
  return S.leads.filter((l) => l.clinicId === clinicId && l.status === 'won' && (+l.amount || 0) > 0 && String(l.saleDate || l.createdTime).slice(0, 10) >= r.start && String(l.saleDate || l.createdTime).slice(0, 10) <= r.end)
    .sort((a, b) => String(a.saleDate || a.createdTime).localeCompare(String(b.saleDate || b.createdTime)));
}
const weekItems = (c, w) => (isShare(c) ? weekSales(c.id, w) : weekLeads(c.id, w));
const shareNet = (c, ls) => +(ls.reduce((s, l) => s + (+l.amount || 0) / 1.24, 0) * ((+c.sharePct || 50) / 100)).toFixed(2);
const weekNet = (c, ls) => (isShare(c) ? shareNet(c, ls) : ls.length * apptFee());
const SEPA_CHIP = { active: ['Εντολή ενεργή', 'won'], pending: ['Αναμονή υπογραφής', 'epik'], '': ['Χωρίς εντολή', 'plain'] };
const PAY_CHIP = { pending: ['Προς χρέωση', 'epik'], processing: ['Σε επεξεργασία', 'rv'], paid: ['Πληρώθηκε ✓', 'won'], failed: ['Απέτυχε', 'lost'] };
async function closeWeek(clinicId, startIso) {
  const c = clinicById(clinicId); const r = weekRange(startIso);
  const ls = weekItems(c, startIso); if (!ls.length) return null;
  const share = isShare(c); const fee = apptFee(); const total = weekNet(c, ls); const vat = +(total * 0.24).toFixed(2);
  const id = 'W' + startIso + '_' + clinicId;
  if (S.billing.some((x) => x.id === id)) return id;
  await data.create('billing', {
    month: startIso.slice(0, 7), clinicId, clinicName: c.name, appts: share ? 0 : ls.length, fee: share ? 0 : fee, total, vat,
    model: share ? 'share' : 'appointment', sales: share ? ls.length : 0, sharePct: share ? (+c.sharePct || 50) : 0,
    gross: +(total + vat).toFixed(2), leadIds: ls.map((l) => l.id), status: 'final',
    period: 'week', periodStart: r.start, periodEnd: r.end, payStatus: 'pending', createdAt: new Date().toISOString(),
  }, id);
  await data.create('finance', {
    kind: 'income', date: r.end, category: share ? 'Αμοιβή διαχείρισης' : 'Χρέωση ραντεβού', clinicId,
    description: share ? `Εβδομάδα ${wkLabel(startIso)}: ${ls.length} πωλήσεις × ${+c.sharePct || 50}% επί καθαρού` : `Εβδομάδα ${wkLabel(startIso)}: ${ls.length} ραντεβού × ${fee}€`,
    net: total, vatRate: 24, vat, gross: +(total + vat).toFixed(2), month: r.end.slice(0, 7),
  });
  return id;
}
async function chargeBilling(id) {
  const res = await callFunction('stripe-billing', { action: 'charge', billingId: id });
  return res.status;
}
function renderWeeks() {
  const sel = $('wk_select'); const cur = sel.value;
  const weeks = lastWeeks(8);
  sel.innerHTML = weeks.map((w) => `<option value="${w}">Εβδ. ${wkLabel(w)}</option>`).join('');
  sel.value = cur && weeks.includes(cur) ? cur : weeks[0];
  const w = sel.value;
  const fee = apptFee();
  const rows = S.clinics.map((c) => ({ c, ls: weekItems(c, w), b: S.billing.find((x) => x.id === 'W' + w + '_' + c.id) }))
    .filter((r) => r.ls.length || r.b);
  $('wkHint').textContent = SET().autoCharge ? 'Αυτόματη χρέωση: ΕΝΕΡΓΗ (κάθε Δευτέρα)' : 'Αυτόματη χρέωση: ανενεργή (Ρυθμίσεις)';
  const el = $('weekTable');
  if (!rows.length) { el.innerHTML = '<div class="empty">Κανένα χρεώσιμο ραντεβού την εβδομάδα ' + wkLabel(w) + '.</div>'; return; }
  let T = 0;
  el.innerHTML = '<table><thead><tr><th>Κλινική</th><th class="num">Ραντεβού / Πωλήσεις</th><th class="num">Σύνολο (με ΦΠΑ)</th><th>Εντολή SEPA</th><th>Πληρωμή</th><th></th></tr></thead><tbody>'
    + rows.map(({ c, ls, b }) => {
      const appts = b ? (b.model === 'share' ? b.sales : b.appts) : ls.length;
      const gross = b ? +b.gross : +(weekNet(c, ls) * 1.24).toFixed(2);
      T += gross;
      const sp = SEPA_CHIP[c.sepaStatus || ''] || SEPA_CHIP[''];
      const pc = b ? (PAY_CHIP[b.payStatus || 'pending'] || PAY_CHIP.pending) : null;
      return `<tr data-clinic="${c.id}" data-week="${w}">
        <td><b>${esc(c.name)}</b></td>
        <td class="num">${appts}${isShare(c) ? ` <span class="chip plain" title="${+c.sharePct || 50}% επί καθαρού ποσού πωλήσεων">${+c.sharePct || 50}%</span>` : ''}</td>
        <td class="num"><b>${eur(gross)}</b></td>
        <td><span class="chip ${sp[1]}">${sp[0]}</span></td>
        <td>${pc ? `<span class="chip ${pc[1]}" title="${esc(b.failReason || '')}">${pc[0]}</span>` : '<span class="chip plain">Ανοιχτή</span>'}</td>
        <td style="white-space:nowrap">
          ${!b ? '<button class="btn small" data-wact="close">Κλείσιμο</button>' : ''}
          ${b && ['pending', 'failed'].includes(b.payStatus || 'pending') && c.sepaStatus === 'active' ? '<button class="btn small primary" data-wact="charge">Χρέωση SEPA</button>' : ''}
          ${c.sepaStatus !== 'active' ? '<button class="btn small" data-wact="mandate">Σύνδεσμος εντολής</button>' : ''}
          ${b && c.email ? '<button class="btn small" data-wact="email">📧</button>' : ''}
        </td></tr>`;
    }).join('')
    + `</tbody><tfoot><tr><td>Σύνολο</td><td></td><td class="num">${eur(T)}</td><td colspan="3"></td></tr></tfoot></table>`;
}
$('wk_select').addEventListener('input', renderWeeks);
async function sendMandateLink(c) {
  const res = await callFunction('stripe-billing', { action: 'setup_link', clinicId: c.id, origin: location.origin });
  try { await navigator.clipboard.writeText(res.url); } catch { /* ok */ }
  if (c.email) {
    const html = `<!DOCTYPE html><html lang="el"><body style="margin:0;background:#EDDBC4;font-family:Arial,sans-serif;"><div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#221A12;border-radius:14px 14px 0 0;padding:22px 28px;"><span style="color:#FDFBF7;font-size:22px;font-weight:bold;">astra</span><span style="color:#BCAC90;font-size:11px;letter-spacing:3px;margin-left:8px;">ΠΛΗΡΩΜΕΣ</span></div>
      <div style="background:#FDFBF7;border-radius:0 0 14px 14px;padding:30px 28px;color:#2A2118;">
      <p style="font-size:16px;font-weight:bold;margin:0 0 8px;">${esc(c.name)} — αυτόματη εβδομαδιαία εξόφληση</p>
      <p style="font-size:14px;line-height:1.6;color:#5A4936;margin:0 0 20px;">Για να μην ασχολείστε με πληρωμές, η εξόφληση των ραντεβού κάθε εβδομάδας γίνεται αυτόματα με πάγια εντολή SEPA από τον λογαριασμό σας, κάθε Δευτέρα. Θα λαμβάνετε πάντα πρώτα την ανάλυση των ραντεβού. Η υπογραφή γίνεται μία φορά, με ασφάλεια μέσω Stripe:</p>
      <table cellpadding="0" cellspacing="0"><tr><td style="background:#6B4526;border-radius:99px;"><a href="${res.url}" style="display:inline-block;padding:12px 26px;color:#FDFBF7;font-size:14px;font-weight:bold;text-decoration:none;">Ενεργοποίηση πάγιας εντολής</a></td></tr></table>
      <p style="font-size:12.5px;color:#5A4936;margin:18px 0 0;">Με εκτίμηση, <b style="color:#2A2118;">Astra Marketing</b></p></div></div></body></html>`;
    await sendEmail(gcalClient(), { to: c.email, subject: 'Astra Marketing — Ενεργοποίηση αυτόματης εξόφλησης', html });
    return 'Στάλθηκε email με τον σύνδεσμο εντολής στο ' + c.email + ' (και αντιγράφηκε).';
  }
  return 'Ο σύνδεσμος εντολής αντιγράφηκε — στείλ’ τον στον γιατρό.';
}
$('weekTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-wact]'); if (!btn) return;
  const tr = btn.closest('tr'); const cid = tr.dataset.clinic; const w = tr.dataset.week;
  const c = clinicById(cid); if (!c) return;
  const act = btn.dataset.wact;
  btn.disabled = true;
  try {
    if (act === 'close') { await closeWeek(cid, w); await refresh(); toast('Η εβδομάδα έκλεισε — έτοιμη για χρέωση.'); }
    if (act === 'charge') {
      if (btn.textContent !== 'Σίγουρα;') { btn.textContent = 'Σίγουρα;'; btn.disabled = false; setTimeout(() => { btn.textContent = 'Χρέωση SEPA'; }, 3000); return; }
      const st = await chargeBilling('W' + w + '_' + cid); await refresh();
      toast(st === 'paid' ? 'Πληρώθηκε ✓' : st === 'processing' ? 'Η χρέωση SEPA στάλθηκε — ολοκληρώνεται σε λίγες εργάσιμες.' : 'Η χρέωση απέτυχε.');
    }
    if (act === 'mandate') { toast(await sendMandateLink(c)); await refresh(); }
    if (act === 'email') {
      const b = S.billing.find((x) => x.id === 'W' + w + '_' + cid);
      const ls = S.leads.filter((l) => (b.leadIds || []).includes(l.id));
      await sendEmail(gcalClient(), { to: c.email, ...billingEmail({ clinicName: c.name, monthLabel: 'εβδομάδα ' + wkLabel(w), appts: b.appts, fee: +b.fee, total: +b.total, vat: +b.vat, gross: +b.gross,
        names: ls.map((l) => ({ name: l.name, date: new Date(l.createdTime).toLocaleDateString('el-GR') })), portalUrl: location.origin + '/client-portal/' }) });
      await data.update('billing', b.id, { emailedAt: new Date().toISOString() });
      toast('Η ανάλυση εβδομάδας στάλθηκε στο ' + c.email + ' ✓');
    }
  } catch (err) {
    const m = String(err.message || '');
    toast(m.includes('missing_stripe_key') || m.includes('STRIPE_SECRET_KEY') ? 'Το Stripe δεν έχει συνδεθεί ακόμα — λείπουν τα κλειδιά.' : m);
  }
  btn.disabled = false;
});
$('wkChargeAll').onclick = async () => {
  const b = $('wkChargeAll');
  if (b.textContent !== 'Σίγουρα; Χρέωση όλων') { b.textContent = 'Σίγουρα; Χρέωση όλων'; setTimeout(() => { b.textContent = 'Χρέωση όλων με εντολή SEPA'; }, 3000); return; }
  b.disabled = true;
  const r = await runWeeklyCharges($('wk_select').value);
  toast(`Κλείσιμο ${r.closed} · χρεώσεις ${r.charged} · αποτυχίες ${r.failed}${r.err ? ' — ' + r.err : ''}`);
  b.disabled = false; b.textContent = 'Χρέωση όλων με εντολή SEPA';
};
/* Κλείνει όλες τις κλινικές μιας εβδομάδας και χρεώνει όσες έχουν ενεργή εντολή. */
async function closeWeekAll(w) {
  let closed = 0;
  for (const c of S.clinics) {
    const id = 'W' + w + '_' + c.id;
    if (!weekItems(c, w).length || S.billing.some((x) => x.id === id)) continue;
    try { await closeWeek(c.id, w); closed++; } catch { /* επόμενο άνοιγμα */ }
  }
  if (closed) await refresh();
  return { closed, charged: 0, failed: 0 };
}
async function runWeeklyCharges(w) {
  let closed = 0, charged = 0, failed = 0, err = '';
  for (const c of S.clinics) {
    const ls = weekItems(c, w);
    const id = 'W' + w + '_' + c.id;
    if (!ls.length && !S.billing.some((x) => x.id === id)) continue;
    try { if (!S.billing.some((x) => x.id === id)) { await closeWeek(c.id, w); closed++; } } catch (e) { err = e.message; continue; }
  }
  await refresh();
  for (const c of S.clinics.filter((x) => x.sepaStatus === 'active')) {
    const b = S.billing.find((x) => x.id === 'W' + w + '_' + c.id);
    if (!b || !['pending', 'failed'].includes(b.payStatus || 'pending')) continue;
    try { const st = await chargeBilling(b.id); if (st === 'failed') failed++; else charged++; } catch (e) { failed++; err = e.message; }
  }
  await refresh();
  return { closed, charged, failed, err };
}

/* ---- Εκκαθάριση πελατών: ραντεβού × αμοιβή, email χρέωσης, καταχώρηση εσόδου ---- */
function billableLeads(clinicId, m) {
  return S.leads.filter((l) => l.clinicId === clinicId && isBooked(l) && monthKey(l.createdTime) === m)
    .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
}
function renderBilling() {
  const sel = $('bl_month'); const cur = sel.value;
  const months = acctMonths();
  sel.innerHTML = months.map((m) => `<option value="${m}">${mLabel(m)}</option>`).join('');
  sel.value = cur && months.includes(cur) ? cur : months[0];
  const m = sel.value;
  const fee = apptFee();
  const rows = S.clinics
    .filter((c) => (c.status || 'active') !== 'prospect')
    .map((c) => ({ c, ls: billableLeads(c.id, m) }))
    .filter((r) => r.ls.length);
  const el = $('billingTable');
  if (!rows.length) { el.innerHTML = '<div class="empty">Κανένα χρεώσιμο ραντεβού τον ' + mLabel(m) + '.</div>'; return; }
  let T = 0;
  el.innerHTML = '<table><thead><tr><th>Κλινική</th><th class="num">Ραντεβού</th><th class="num">Ποσό</th><th class="num">ΦΠΑ 24%</th><th class="num">Σύνολο</th><th>Κατάσταση</th><th></th></tr></thead><tbody>'
    + rows.map(({ c, ls }) => {
      const total = ls.length * fee, vat = +(total * 0.24).toFixed(2);
      T += total;
      const b = S.billing.find((x) => x.id === m + '_' + c.id);
      return `<tr data-clinic="${c.id}" data-month="${m}">
        <td><b>${esc(c.name)}</b></td>
        <td class="num">${ls.length}</td>
        <td class="num">${eur(total)}</td>
        <td class="num">${eur(vat)}</td>
        <td class="num"><b>${eur(total + vat)}</b></td>
        <td>${(() => { const wk = S.billing.filter((x) => x.period === 'week' && x.clinicId === c.id && monthKey(x.periodStart) === m); const paid = wk.filter((x) => x.payStatus === 'paid').reduce((s, x) => s + (+x.gross || 0), 0); return wk.length ? `<span class="chip ${paid ? 'won' : 'epik'}">${wk.length} εβδ. · πληρώθηκαν ${eur(paid)}</span>` : '<span class="chip plain">—</span>'; })()}</td>
        <td style="white-space:nowrap">
          <button class="btn small" data-bact="list">Λίστα</button>
          ${c.email ? `<button class="btn small" data-bact="email">📧 Χρέωση</button>` : ''}
        </td></tr>`;
    }).join('')
    + `</tbody><tfoot><tr><td>Σύνολο</td><td></td><td class="num">${eur(T)}</td><td class="num">${eur(T * 0.24)}</td><td class="num">${eur(T * 1.24)}</td><td colspan="2"></td></tr></tfoot></table>`;
}
$('bl_month').addEventListener('input', renderBilling);
$('billingTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-bact]'); if (!btn) return;
  const tr = btn.closest('tr'); const cid = tr.dataset.clinic; const m = tr.dataset.month;
  const c = clinicById(cid); if (!c) return;
  const ls = billableLeads(cid, m);
  const fee = apptFee(); const total = ls.length * fee; const vat = +(total * 0.24).toFixed(2);
  const act = btn.dataset.bact;
  if (act === 'list') {
    const txt = `Χρεώσιμα ραντεβού ${mLabel(m)} — ${c.name} (${ls.length} × ${fee}€):\n` +
      ls.map((l, i) => `${i + 1}. ${l.name} — ${new Date(l.createdTime).toLocaleDateString('el-GR')}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Η λίστα (' + ls.length + ' ραντεβού) αντιγράφηκε.'); } catch { toast(txt.slice(0, 300)); }
    return;
  }
  if (act === 'final') {
    btn.disabled = true;
    try {
      await data.create('billing', {
        month: m, clinicId: cid, clinicName: c.name, appts: ls.length, fee,
        total, vat, gross: +(total + vat).toFixed(2),
        leadIds: ls.map((l) => l.id), status: 'final', createdAt: new Date().toISOString(),
      }, m + '_' + cid);
      const [y, mo] = m.split('-').map(Number);
      const lastDay = new Date(y, mo, 0).getDate();
      await data.create('finance', {
        kind: 'income', date: `${m}-${lastDay}`, category: 'Χρέωση ραντεβού', clinicId: cid,
        description: `Χρέωση ${mLabel(m)}: ${ls.length} ραντεβού × ${fee}€`,
        net: total, vatRate: 24, vat, gross: +(total + vat).toFixed(2), month: m,
      });
      await refresh();
      toast(`Καταχωρήθηκε: ${c.name} — ${eur(total)} (+ΦΠΑ). Μπήκε στα Οικονομικά & στον Λογιστή.`);
    } catch (err) { toast('Αποτυχία: ' + err.message); btn.disabled = false; }
    return;
  }
  if (act === 'email') {
    btn.disabled = true; btn.textContent = '…';
    try {
      const names = ls.map((l) => ({ name: l.name, date: new Date(l.createdTime).toLocaleDateString('el-GR') }));
      await sendEmail(gcalClient(), { to: c.email, ...billingEmail({ clinicName: c.name, monthLabel: mLabel(m), appts: ls.length, fee, total, vat, gross: total + vat, names, portalUrl: location.origin + '/client-portal/' }) });
      const b = S.billing.find((x) => x.id === m + '_' + cid);
      if (b) await data.update('billing', b.id, { emailedAt: new Date().toISOString() });
      await refresh();
      toast('Η χρέωση στάλθηκε στο ' + c.email + ' ✓');
    } catch (err) { toast(err.message); }
    btn.disabled = false; btn.textContent = '📧 Χρέωση';
  }
});

/* ---- Λογιστής: sheet ανά μήνα + αποστολή εξόδων ---- */
const acctRow = (m) => S.acct.find((a) => a.id === m);
function acctMonths() { const out = []; let m = nowMonth(); for (let i = 0; i < 12; i++) { out.push(m); m = prevMonth(m); } return out; }
function prevMonth(m) { const [y, mo] = m.split('-').map(Number); return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'); }
function renderAccountant() {
  const sel = $('ac_month'); const cur = sel.value;
  const months = acctMonths();
  sel.innerHTML = months.map((m) => `<option value="${m}">${mLabel(m)}</option>`).join('');
  sel.value = cur && months.includes(cur) ? cur : months[0];
  const m = sel.value;
  const a = acctRow(m);
  $('ac_sheet').value = a ? (a.sheetUrl || '') : '';
  $('acOpen').hidden = !(a && a.sheetUrl);
  const rows = S.fin.filter((f) => monthKey(f.date) === m);
  const exp = rows.filter((f) => f.kind === 'expense');
  $('acStatus').innerHTML = (a && a.status === 'sent')
    ? `<span class="chip won">Στάλθηκε ${a.sentAt ? new Date(a.sentAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) : ''}</span> ${exp.length} έξοδα · ${rows.length - exp.length} έσοδα`
    : `<span class="chip epik">Εκκρεμεί</span> ${exp.length} έξοδα · ${rows.length - exp.length} έσοδα του μήνα`;
  renderReceipts(m);
}
/* ---- αποδείξεις/τιμολόγια ανά μήνα: φωτογραφίες & PDF στο Google Drive, φάκελος «Αποδείξεις / Τιμολόγια»/YYYY-MM ---- */
const driveLink = (u) => (/^https:\/\/(drive|docs)\.google\.com\//.test(u || '') ? u : '');
const acctFiles = (m) => { const a = acctRow(m); return a && Array.isArray(a.files) ? a.files : []; };
function renderReceipts(m) {
  const cloud = CONFIG.backend === 'supabase';
  $('acAddFiles').hidden = !cloud;
  const files = acctFiles(m);
  const fid = (files.find((f) => f.folderId) || {}).folderId;
  $('acFilesHint').innerHTML = !cloud ? '' : `${files.length} αρχεία για ${mLabel(m)} — αποθηκεύονται στο Google Drive, φάκελος «${esc(RECEIPTS_FOLDER)}» › ${m}.`
    + (fid ? ` <a href="https://drive.google.com/drive/folders/${encodeURIComponent(fid)}" target="_blank" rel="noopener">Άνοιγμα φακέλου ↗</a>` : '');
  $('acFiles').innerHTML = !cloud ? '<div class="empty">Το ανέβασμα αποδείξεων είναι διαθέσιμο μόνο σε cloud mode.</div>'
    : files.length ? files.map((f, i) => `<div class="trashrow" data-i="${i}" style="padding:10px 14px">
        <span>${esc(f.name)}</span>
        <span class="tmeta">${(f.size / 1024 / 1024).toFixed(1)}MB · ${new Date(f.at).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</span>
        ${driveLink(f.link) ? `<a class="btn small" style="text-decoration:none" href="${esc(f.link)}" target="_blank" rel="noopener">Άνοιγμα ↗</a>` : ''}
        <button class="btn small danger" data-act="rcdel">✕</button>
      </div>`).join('')
      : `<div class="empty">Καμία απόδειξη για ${mLabel(m)}. Τράβα φωτογραφία ή ανέβασε PDF — αποθηκεύονται στο Google Drive ανά μήνα.</div>`;
}
async function saveAcctFiles(m, files) {
  if (acctRow(m)) await data.update('accountant', m, { files });
  else await data.create('accountant', { sheetUrl: '', sheetId: '', status: 'open', notes: '', files }, m);
}
$('acAddFiles').onclick = () => $('acFile').click();
$('acFile').addEventListener('change', async (e) => {
  const picked = [...e.target.files]; e.target.value = '';
  const m = $('ac_month').value;
  if (!picked.length || !m) return;
  const files = [...acctFiles(m)];
  let ok = 0, lastErr = '';
  toast(`Ανέβασμα ${picked.length} αρχείων…`);
  for (const file of picked) {
    if (file.size > 40 * 1024 * 1024) { lastErr = 'Μέγιστο μέγεθος 40MB ανά αρχείο.'; continue; }
    try {
      const up = await uploadReceipt(gcalClient(), m, file);
      files.push({ name: file.name, driveId: up.id, link: up.link, folderId: up.folderId, size: file.size, at: new Date().toISOString(), by: userEmail() });
      ok++;
    } catch (err) { lastErr = err.message; }
  }
  try { if (ok) { await saveAcctFiles(m, files); await refresh(); } }
  catch (err) { lastErr = 'Αποτυχία: ' + err.message; ok = 0; }
  toast(ok ? `Ανέβηκαν ${ok} αρχεία στον ${mLabel(m)} ✓` + (lastErr ? ' · ' + lastErr : '') : lastErr || 'Δεν ανέβηκε τίποτα.');
});
$('acFiles').addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]'); if (!act) return;
  const m = $('ac_month').value;
  const f = acctFiles(m)[+act.closest('[data-i]').dataset.i]; if (!f) return;
  if (act.textContent !== 'Σίγουρα;') { act.textContent = 'Σίγουρα;'; setTimeout(() => { act.textContent = '✕'; }, 2500); return; }
  try {
    await trashReceipt(gcalClient(), f.driveId);
    await saveAcctFiles(m, acctFiles(m).filter((x) => x.driveId !== f.driveId));
    if (f.finId && S.fin.some((x) => x.id === f.finId)) await data.update('finance', f.finId, { receiptLink: '', receiptId: '' });
    await refresh(); toast('Το αρχείο πήγε στον κάδο του Drive.');
  } catch (err) { toast(err.message); }
});
function acctMatrix(m) {
  const rows = S.fin.filter((f) => monthKey(f.date) === m).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const head = ['Ημερομηνία', 'Τύπος', 'Κατηγορία', 'Περιγραφή', 'Κλινική', 'Καθαρό', 'ΦΠΑ %', 'ΦΠΑ', 'Μικτό', 'Παραστατικό'];
  const body = rows.map((f) => [f.date, f.kind === 'income' ? 'Έσοδο' : 'Έξοδο', f.category || '', f.description || '', (clinicById(f.clinicId) || {}).name || '', +f.net || 0, +f.vatRate || 0, +f.vat || 0, +f.gross || 0, driveLink(f.receiptLink)]);
  const fid = (acctFiles(m).find((x) => x.folderId) || {}).folderId;
  const sum = (kind, k) => rows.filter((f) => f.kind === kind).reduce((s, f) => s + (+f[k] || 0), 0);
  const foot = [
    [], ['ΣΥΝΟΛΑ', '', '', '', '', '', '', '', ''],
    ['', 'Έξοδα', '', '', '', +sum('expense', 'net').toFixed(2), '', +sum('expense', 'vat').toFixed(2), +sum('expense', 'gross').toFixed(2)],
    ['', 'Έσοδα', '', '', '', +sum('income', 'net').toFixed(2), '', +sum('income', 'vat').toFixed(2), +sum('income', 'gross').toFixed(2)],
    ['', '', '', '', '', '', '', '', ''],
    ['Astra Marketing — Astra HQ export', mLabel(m), new Date().toLocaleDateString('el-GR'), '', '', '', '', '', ''],
    ...(fid ? [['Φάκελος παραστατικών μήνα', 'https://drive.google.com/drive/folders/' + fid]] : []),
  ];
  return { rows, matrix: [head, ...body, ...foot] };
}
$('ac_month').addEventListener('input', renderAccountant);
$('acSaveLink').onclick = async () => {
  const m = $('ac_month').value;
  const url = $('ac_sheet').value.trim();
  const sid = spreadsheetIdFrom(url);
  if (url && !sid) { toast('Το link δεν μοιάζει με Google Sheet.'); return; }
  try {
    const a = acctRow(m);
    if (a) await data.update('accountant', m, { sheetUrl: url, sheetId: sid || '' });
    else await data.create('accountant', { sheetUrl: url, sheetId: sid || '', status: 'open', notes: '' }, m);
    await refresh(); toast('Το sheet του ' + mLabel(m) + ' αποθηκεύτηκε.');
  } catch (e) { toast('Αποτυχία: ' + e.message); }
};
$('acOpen').onclick = () => { const a = acctRow($('ac_month').value); if (a && a.sheetUrl) window.open(a.sheetUrl, '_blank', 'noopener'); };
$('acExport').onclick = () => {
  const m = $('ac_month').value;
  const { rows, matrix } = acctMatrix(m);
  if (!rows.length) { toast('Καμία εγγραφή στον μήνα.'); return; }
  downloadCSV('astra-logistis-' + m + '.csv', matrix[0], matrix.slice(1));
};
$('acSend').onclick = async () => {
  const m = $('ac_month').value;
  const a = acctRow(m);
  if (!a || !a.sheetId) { toast('Αποθήκευσε πρώτα το link του sheet για τον ' + mLabel(m) + '.'); return; }
  const { rows, matrix } = acctMatrix(m);
  if (!rows.length) { toast('Καμία εγγραφή στον μήνα — δεν στάλθηκε τίποτα.'); return; }
  const b = $('acSend'); b.disabled = true; b.textContent = 'Αποστολή…';
  try {
    await writeToSheet(gcalClient(), a.sheetId, matrix);
    await data.update('accountant', m, { status: 'sent', sentAt: new Date().toISOString() });
    await refresh();
    toast(`Γράφτηκαν ${rows.length} εγγραφές στο sheet του λογιστή ✓`);
  } catch (e) {
    if (e.code === 'connect_needed') toast('Πάτα πρώτα «Σύνδεση Google» στο Ημερολόγιο (μία φορά).');
    else toast(e.message);
  }
  b.disabled = false; b.textContent = '➤ Αποστολή εξόδων στο sheet';
};

/* ---- πρόβλεψη 3 μηνών ---- */
function renderCashflow() {
  const recs = S.rec.filter((r) => r.active);
  const recInc = recs.filter((r) => r.kind === 'income').reduce((s, r) => s + (+r.net || 0), 0);
  const recExp = recs.filter((r) => r.kind === 'expense').reduce((s, r) => s + (+r.net || 0), 0);
  const covered = new Set(recs.filter((r) => r.kind === 'income' && r.clinicId).map((r) => r.clinicId));
  const feesExtra = S.clinics.filter((c) => +c.fee > 0 && !covered.has(c.id)).reduce((s, c) => s + (+c.fee || 0), 0);
  const inc = recInc + feesExtra, exp = recExp, net = inc - exp;
  let m = nowMonth();
  const tiles = [];
  for (let i = 0; i < 3; i++) {
    m = nextMonth(m);
    tiles.push(`<div class="tile"><div class="lb">${mLabel(m)}</div><div class="v ${net >= 0 ? 'pos' : 'neg'}">${eur(net)}</div><div class="d">+${eur(inc)} πάγια έσοδα · −${eur(exp)} πάγια έξοδα</div></div>`);
  }
  $('cashflowTiles').innerHTML = tiles.join('');
}
/* ---- κερδοφορία πελατών (τρέχον τρίμηνο) ---- */
function quarterMonthsOf(qk) {
  const [y, q] = qk.split('-Q').map(Number);
  return [0, 1, 2].map((i) => y + '-' + String((q - 1) * 3 + 1 + i).padStart(2, '0'));
}
function renderProfit() {
  const qk = quarterOf(new Date().toISOString());
  const qm = quarterMonthsOf(qk);
  const rows = S.clinics.map((c) => {
    const inc = S.fin.filter((f) => f.kind === 'income' && f.clinicId === c.id && quarterOf(f.date) === qk).reduce((s, f) => s + (+f.net || 0), 0);
    const exp = S.fin.filter((f) => f.kind === 'expense' && f.clinicId === c.id && quarterOf(f.date) === qk).reduce((s, f) => s + (+f.net || 0), 0);
    const spend = S.camps.filter((x) => x.clinicId === c.id && qm.includes(x.month)).reduce((s, x) => s + (+x.spend || 0), 0);
    return { c, inc, exp, spend, net: inc - exp - spend };
  }).filter((r) => r.inc || r.exp || r.spend).sort((a, b) => b.net - a.net);
  $('profitTable').innerHTML = rows.length
    ? '<table><thead><tr><th>Κλινική</th><th class="num">Έσοδα</th><th class="num">Ad spend</th><th class="num">Λοιπά έξοδα</th><th class="num">Καθαρό</th></tr></thead><tbody>'
      + rows.map((r) => `<tr><td><b>${esc(r.c.name)}</b></td><td class="num">${eur(r.inc)}</td><td class="num">${eur(r.spend)}</td><td class="num">${eur(r.exp)}</td><td class="num ${r.net >= 0 ? 'pos' : 'neg'}"><b>${eur(r.net)}</b></td></tr>`).join('')
      + '</tbody></table>'
    : '<div class="empty">Θα γεμίσει μόλις καταχωρηθούν έσοδα/έξοδα με κλινική στο τρέχον τρίμηνο.</div>';
}
/* ---- έξοδα ανά κατηγορία (τρέχον τρίμηνο) ---- */
const CAT_SHORT = [['Meta', 'Meta'], ['Google', 'Google'], ['Εργαλεία', 'Εργαλεία'], ['Μισθοδοσία', 'Μισθοί'], ['Λογιστής', 'Λογιστής'], ['Ενοίκιο', 'Ενοίκιο']];
function renderExpChart() {
  const qk = quarterOf(new Date().toISOString());
  const exp = S.fin.filter((f) => f.kind === 'expense' && quarterOf(f.date) === qk);
  if (!exp.length) { $('chartExpenses').innerHTML = '<div class="empty" style="padding:16px">Κανένα έξοδο στο τρέχον τρίμηνο.</div>'; return; }
  const byCat = {};
  exp.forEach((f) => {
    const hit = CAT_SHORT.find(([k]) => (f.category || '').includes(k));
    const key = hit ? hit[1] : 'Άλλο';
    byCat[key] = (byCat[key] || 0) + (+f.net || 0);
  });
  const keys = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  $('chartExpenses').innerHTML = groupedBars(keys, [{ name: 'Έξοδα', vals: keys.map((k) => byCat[k]), color: 'var(--c1)' }], (v) => eur(v), (k) => k);
}
/* ---- import οικονομικών από CSV ---- */
$('btnFinImport').onclick = () => $('finCsvFile').click();
$('finCsvFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const rows = parseCSV(await file.text());
  if (rows.length < 2) { toast('Το αρχείο είναι άδειο.'); return; }
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const col = (...names) => h.findIndex((x) => names.some((n) => x.includes(n)));
  const iD = col('ημερομ', 'date'), iK = col('τύπος', 'kind'), iC = col('κατηγορ', 'category'),
    iDesc = col('περιγραφ', 'description'), iN = col('καθαρ', 'net'), iV = col('φπα %', 'vat_rate', 'φπα%');
  if (iD < 0 || iN < 0) { toast('Χρειάζονται τουλάχιστον στήλες Ημερομηνία και Καθαρό.'); return; }
  const normDate = (v) => {
    v = String(v).trim();
    const m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return v.slice(0, 10);
  };
  let made = 0;
  for (const r of rows.slice(1).slice(0, 500)) {
    const g = (i) => (i >= 0 && i < r.length ? String(r[i]).trim() : '');
    const net = parseNum(g(iN)); if (!net) continue;
    const kindRaw = g(iK).toLowerCase();
    const kind = kindRaw.includes('εσοδ') || kindRaw.includes('income') ? 'income' : 'expense';
    const vatRate = iV >= 0 ? parseNum(g(iV)) : 24;
    try {
      await data.create('finance', {
        kind, date: normDate(g(iD)) || todayISO(), category: g(iC) || (kind === 'income' ? 'Άλλο έσοδο' : 'Άλλο έξοδο'),
        clinicId: null, description: g(iDesc), net,
        vatRate, vat: +(net * vatRate / 100).toFixed(2), gross: +(net * (1 + vatRate / 100)).toFixed(2),
      });
      made++;
    } catch { break; }
  }
  await refresh();
  toast(made ? `Μπήκαν ${made} εγγραφές από το CSV.` : 'Δεν βρέθηκαν έγκυρες εγγραφές στο CSV.');
});

/* ============ REPORTS ============ */
['rpClinic', 'rpMonth'].forEach((i) => $(i).addEventListener('input', renderReport));
$('btnPrint').onclick = () => window.print();
$('btnEmailReport').onclick = async () => {
  const c = clinicById($('rpClinic').value) || S.clinics[0];
  if (!c) { toast('Καμία κλινική.'); return; }
  if (!c.email) { toast('Η κλινική δεν έχει email — βάλ’ το στην Επεξεργασία.'); return; }
  const mk = $('rpMonth').value || nowMonth();
  const b = $('btnEmailReport'); b.disabled = true; b.textContent = 'Αποστολή…';
  try {
    const st = computeStats(mk, c);
    await sendEmail(gcalClient(), { to: c.email, ...reportEmail({ clinicName: c.name, monthLabel: mLabel(mk), s: st, fee: apptFee(), portalUrl: location.origin + '/client-portal/' }) });
    toast('Η αναφορά ' + mLabel(mk) + ' στάλθηκε στο ' + c.email + ' ✓');
  } catch (e) { toast(e.message); }
  b.disabled = false; b.textContent = '📧 Email στον πελάτη';
};
$('btnCopyReport').onclick = () => {
  const c = clinicById($('rpClinic').value) || S.clinics[0];
  if (!c) { toast('Καμία κλινική.'); return; }
  const mk = $('rpMonth').value || nowMonth();
  const s = computeStats(mk, c);
  const lines = [
    `📊 ${c.name} — Αναφορά ${mLabel(mk)} (Astra Marketing)`,
    `• Νέα leads: ${s.leads}`,
    `• Ραντεβού: ${s.rv}` + (s.leads ? ` (${Math.round(100 * s.rv / s.leads)}%)` : ''),
    `• Ήρθαν: ${s.shows}`,
    `• Νέοι ασθενείς: ${s.sales}`,
    `• Έσοδα από νέους ασθενείς: ${eur(s.revenue)}`,
    `• Διαφημιστική δαπάνη: ${eur(s.spend)}` + (s.cpl ? ` (CPL ${eur(s.cpl)})` : ''),
    s.spend > 0 ? `• Απόδοση (ROAS): ${s.roas.toFixed(2)}×` : null,
  ].filter(Boolean).join('\n');
  try { navigator.clipboard.writeText(lines).then(() => toast('Η αναφορά αντιγράφηκε — έτοιμη για Viber/WhatsApp.')).catch(() => toast(lines)); } catch { toast(lines); }
};
function renderReport() {
  fillClinicSelect($('rpClinic'));
  const rm = $('rpMonth'); const cur = rm.value;
  const months = lastMonths(12).reverse();
  rm.innerHTML = months.map((m) => `<option value="${m}">${mLabel(m)}</option>`).join('');
  rm.value = cur && months.includes(cur) ? cur : nowMonth();
  const c = clinicById($('rpClinic').value) || S.clinics[0];
  const mk = rm.value;
  const el = $('reportBody');
  if (!c) { el.innerHTML = '<div class="card empty"><div class="big">Καμία κλινική</div>Φτιάξε πρώτα μια κλινική για να βγάλεις αναφορά.</div>'; return; }
  const ls = S.leads.filter((l) => l.clinicId === c.id && monthKey(l.createdTime) === mk);
  const won = S.leads.filter((l) => l.clinicId === c.id && l.status === 'won' && monthKey(l.saleDate || l.createdTime) === mk);
  const rv = ls.filter((l) => ['rv', 'show', 'won'].includes(l.status));
  const show = ls.filter((l) => ['show', 'won'].includes(l.status));
  const rev = won.reduce((s, l) => s + (+l.amount || 0), 0);
  const cps = S.camps.filter((x) => x.clinicId === c.id && x.month === mk);
  const spend = cps.reduce((s, x) => s + (+x.spend || 0), 0);
  const tile = (lb, v, d) => `<div class="tile"><div class="lb">${lb}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  el.innerHTML = `<div class="report">
    <div class="rhead">
      <img alt="astra" src="/app/assets/logo-white.webp">
      <div class="rt"><b>Μηνιαία αναφορά · ${esc(c.name)}</b><span>${mLabel(mk)} — Astra Marketing</span></div>
    </div>
    <div class="tiles">
      ${tile('Νέα leads', ls.length, c.goalLeads ? 'στόχος ' + c.goalLeads : '')}
      ${tile('Ραντεβού', rv.length, ls.length ? Math.round(100 * rv.length / ls.length) + '% των leads' : '')}
      ${tile('Ήρθαν', show.length, rv.length ? Math.round(100 * show.length / rv.length) + '% των ραντεβού' : '')}
      ${tile('Πωλήσεις', won.length, c.goalSales ? 'στόχος ' + c.goalSales : '')}
      ${tile('Έσοδα', eur(rev), won.length ? 'μ.ό. ' + eur(rev / won.length) : '')}
      ${tile('Δαπάνη διαφήμισης', eur(spend), ls.length && spend ? 'CPL ' + eur(spend / ls.length) : '')}
      ${tile('ROAS', spend > 0 ? (rev / spend).toFixed(2) + '×' : '—', 'έσοδα ÷ δαπάνη')}
    </div>
    <h4>Η επένδυσή σας τον μήνα</h4>
    ${(() => {
      const fee = +c.fee || 0;
      const invest = fee + spend;
      const roi = invest > 0 ? rev / invest : 0;
      return `<div class="tiles">
        <div class="tile"><div class="lb">Αμοιβή διαχείρισης</div><div class="v">${eur(fee)}</div></div>
        <div class="tile"><div class="lb">Δαπάνη διαφήμισης</div><div class="v">${eur(spend)}</div></div>
        <div class="tile"><div class="lb">Συνολική επένδυση</div><div class="v">${eur(invest)}</div></div>
        <div class="tile"><div class="lb">Έσοδα από νέους ασθενείς</div><div class="v">${eur(rev)}</div></div>
        <div class="tile"><div class="lb">Απόδοση επένδυσης</div><div class="v ${invest > 0 ? (roi >= 1.5 ? 'pos' : roi < 1 ? 'neg' : '') : ''}">${invest > 0 ? roi.toFixed(2) + '×' : '—'}</div><div class="d">${invest > 0 && rev - invest !== 0 ? (rev - invest > 0 ? '+' : '') + eur(rev - invest).replace('-', '−') + ' καθαρό όφελος' : ''}</div></div>
      </div>`;
    })()}
    <h4>Καμπάνιες μήνα</h4>
    ${cps.length ? `<div class="tablewrap"><table><thead><tr><th>Καμπάνια</th><th class="num">Δαπάνη</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Πωλήσεις</th><th class="num">Έσοδα</th><th class="num">ROAS</th></tr></thead><tbody>
      ${cps.map((cp) => {
        const cls = campLeads(cp).filter((l) => monthKey(l.createdTime) === mk);
        const cw = cls.filter((l) => l.status === 'won');
        const cr = cw.reduce((s, l) => s + (+l.amount || 0), 0);
        return `<tr><td>${esc(cp.name)}</td><td class="num">${eur(cp.spend)}</td><td class="num">${cls.length}</td><td class="num">${cls.length && cp.spend ? eur(cp.spend / cls.length) : '—'}</td><td class="num">${cw.length}</td><td class="num">${eur(cr)}</td><td class="num">${cp.spend > 0 ? (cr / cp.spend).toFixed(2) + '×' : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p style="color:var(--soft);font-size:13px">Καμία καμπάνια καταχωρημένη για αυτόν τον μήνα.</p>'}
    <h4>Πωλήσεις μήνα</h4>
    ${won.length ? `<div class="tablewrap"><table><thead><tr><th>Όνομα</th><th>Καμπάνια</th><th class="num">Ποσό</th></tr></thead><tbody>
      ${won.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.campaign || '—')}</td><td class="num">${eur(l.amount)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p style="color:var(--soft);font-size:13px">Καμία καταγεγραμμένη πώληση αυτόν τον μήνα.</p>'}
  </div>`;
}

/* ============ MONTHLY STATS ARCHIVE ============ */
const ARCHIVE_START = '2026-10';
function computeStats(m, clinic) {
  const inClinic = (x) => !clinic || x.clinicId === clinic.id;
  const ls = S.leads.filter((l) => monthKey(l.createdTime) === m && inClinic(l));
  const salesLs = S.leads.filter((l) => l.status === 'won' && monthKey(l.saleDate || l.createdTime) === m && inClinic(l));
  const revenue = salesLs.reduce((s, l) => s + (+l.amount || 0), 0);
  const cps = S.camps.filter((c) => c.month === m && inClinic(c));
  const spend = cps.reduce((s, c) => s + (+c.spend || 0), 0);
  const fin = S.fin.filter((f) => monthKey(f.date) === m && inClinic(f));
  const agencyIncome = fin.filter((f) => f.kind === 'income').reduce((s, f) => s + (+f.net || 0), 0);
  const agencyExpenses = fin.filter((f) => f.kind === 'expense').reduce((s, f) => s + (+f.net || 0), 0);
  return {
    month: m, clinicId: clinic ? clinic.id : null, clinicName: clinic ? clinic.name : '',
    leads: ls.length,
    rv: ls.filter((l) => ['rv', 'show', 'won'].includes(l.status)).length,
    shows: ls.filter((l) => ['show', 'won'].includes(l.status)).length,
    sales: salesLs.length, revenue: +revenue.toFixed(2), spend: +spend.toFixed(2),
    impressions: cps.reduce((s, c) => s + (+c.impressions || 0), 0),
    clicks: cps.reduce((s, c) => s + (+c.clicks || 0), 0),
    cpl: ls.length && spend ? +(spend / ls.length).toFixed(2) : 0,
    roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
    agencyIncome: +agencyIncome.toFixed(2), agencyExpenses: +agencyExpenses.toFixed(2),
    agencyProfit: +(agencyIncome - agencyExpenses).toFixed(2),
  };
}
function nextMonth(m) { const [y, mo] = m.split('-').map(Number); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); }
function closedMonths() { const out = []; let m = ARCHIVE_START; const cur = nowMonth(); while (m < cur) { out.push(m); m = nextMonth(m); } return out; }
/* Κλειδώνει κάθε ολοκληρωμένο μήνα (από Οκτ ’26) που δεν έχει αποθηκευτεί ακόμα. */
async function archiveMonthlyStats() {
  const have = new Set(S.stats.map((s) => s.id));
  let made = 0;
  for (const m of closedMonths()) {
    const docs = [];
    if (!have.has(m)) docs.push({ id: m, ...computeStats(m, null) });
    for (const c of S.clinics) { const id = m + '_' + c.id; if (!have.has(id)) docs.push({ id, ...computeStats(m, c) }); }
    for (const d of docs) {
      const { id, ...body } = d;
      try { await data.create('monthly_stats', { ...body, computedAt: new Date().toISOString() }, id); made++; }
      catch { /* πιθανή κούρσα με άλλη συσκευή — αδιάφορο */ }
    }
  }
  if (made) { toast('Κλείδωσαν τα στατιστικά ' + made + ' εγγραφών μηνιαίου αρχείου.'); await refresh(); }
  // live snapshot τρέχοντος μήνα — το βλέπει και το client portal
  const mkNow = nowMonth();
  const curDocs = [{ id: mkNow, ...computeStats(mkNow, null) }, ...S.clinics.map((c) => ({ id: mkNow + '_' + c.id, ...computeStats(mkNow, c) }))];
  for (const d of curDocs) {
    const { id, ...body } = d; body.computedAt = new Date().toISOString();
    try {
      if (S.stats.some((s) => s.id === id)) await data.update('monthly_stats', id, body);
      else await data.create('monthly_stats', body, id);
    } catch { /* δευτερεύον */ }
  }
}
async function recomputeMonth(m) {
  const targets = [{ id: m, clinic: null }, ...S.clinics.map((c) => ({ id: m + '_' + c.id, clinic: c }))];
  for (const t of targets) {
    const body = { ...computeStats(m, t.clinic), computedAt: new Date().toISOString() };
    try {
      if (S.stats.some((s) => s.id === t.id)) await data.update('monthly_stats', t.id, body);
      else await data.create('monthly_stats', body, t.id);
    } catch (e) { toast('Αποτυχία: ' + e.message); return; }
  }
  await refresh();
  toast('Ο μήνας ' + mLabel(m) + ' επανυπολογίστηκε.');
}
$('rsClinic').addEventListener('input', renderStatsArchive);
function statsRow(s, live) {
  return `<tr data-month="${s.month}">
    <td class="mono"><b>${mLabel(s.month)}</b>${live ? ' <span class="chip epik">τρέχων</span>' : ''}</td>
    <td class="num">${s.leads}</td><td class="num">${s.rv}</td><td class="num">${s.shows}</td>
    <td class="num">${s.sales}</td><td class="num">${eur(s.revenue)}</td>
    <td class="num">${eur(s.spend)}</td>
    <td class="num">${s.cpl ? eur(s.cpl) : '—'}</td>
    <td class="num">${s.rv && s.spend ? eur(s.spend / s.rv) : '—'}</td>
    <td class="num ${s.spend > 0 ? (s.roas >= 2 ? 'pos' : s.roas < 1 ? 'neg' : '') : ''}">${s.spend > 0 ? s.roas.toFixed(2) + '×' : '—'}</td>
    <td class="num">${eur(s.agencyIncome)}</td><td class="num">${eur(s.agencyExpenses)}</td>
    <td class="num ${s.agencyProfit >= 0 ? 'pos' : 'neg'}">${eur(s.agencyProfit)}</td>
    <td>${live ? '' : '<button class="btn small" data-act="recalc" title="Επανυπολογισμός από τα τρέχοντα δεδομένα">⟳</button>'}</td>
  </tr>`;
}
function renderStatsArchive() {
  fillClinicSelect($('rsClinic'), 'Σύνολο Astra');
  const fc = $('rsClinic').value;
  const clinic = fc ? clinicById(fc) : null;
  const stored = S.stats.filter((s) => (fc ? s.clinicId === fc : !s.clinicId) && s.month < nowMonth()).sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const liveRow = { ...computeStats(nowMonth(), clinic) };
  const el = $('statsTable');
  el.innerHTML = '<table><thead><tr><th>Μήνας</th><th class="num">Leads</th><th class="num">Ραντεβού</th><th class="num">Ήρθαν</th><th class="num">Πωλήσεις</th><th class="num">Έσοδα</th><th class="num">Δαπάνη</th><th class="num">CPL</th><th class="num">€/Ραντ.</th><th class="num">ROAS</th><th class="num">Έσοδα Astra</th><th class="num">Έξοδα</th><th class="num">Αποτέλεσμα</th><th></th></tr></thead><tbody>'
    + statsRow(liveRow, true)
    + stored.map((s) => statsRow(s, false)).join('')
    + '</tbody></table>'
    + (!stored.length ? '<div class="empty" style="padding:20px">Ο πρώτος μήνας που θα κλειδώσει είναι ο Οκτώβριος ’26 — αποθηκεύεται αυτόματα με το πρώτο άνοιγμα τον Νοέμβριο, και μένει για πάντα ακόμα κι αν αλλάξουν leads ή καμπάνιες.</div>' : '');
}
$('statsTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act=recalc]'); if (!b) return;
  b.disabled = true;
  await recomputeMonth(b.closest('tr').dataset.month);
});

/* ============ SETTINGS ============ */
function renderSettings() {
  const s = SET();
  renderPush();
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  $('notifState').textContent = perm === 'unsupported' ? 'Ο browser δεν υποστηρίζει ειδοποιήσεις.'
    : notifOn() ? '✓ Ενεργές σε αυτή τη συσκευή.'
    : perm === 'denied' ? 'Αποκλείστηκαν από τον browser — ενεργοποίησέ τες από τις ρυθμίσεις σελίδας (🔒 στη γραμμή διεύθυνσης).'
    : 'Ανενεργές.';
  $('st_autoSync').checked = s.autoSync !== false;
  $('st_callers').value = s.callerEmails || '';
  $('st_taskOwners').value = s.taskOwners || 'Apo,Marga';
  $('st_gcalKey').value = s.gcalApiKey || '';
  $('st_gcalClient').value = s.gcalClientId || '';
  $('st_gcalId').value = s.gcalCalendarId || '';
  $('st_goalQ').value = s.goalQuarterRevenue || '';
  $('st_retention').value = s.retentionMonths || '';
  $('st_taxPrepay').value = s.taxPrepayPct ?? 80;
  $('st_apptFee').value = s.appointmentFee ?? 50;
  $('st_autoReport').checked = !!s.autoReport;
  $('st_autoCharge').checked = !!s.autoCharge;
  renderTrash();
  $('st_metaToken').value = s.metaToken || '';
  $('st_metaAccount').value = s.metaAccount || '';
}
$('btnSaveSettings').onclick = async () => {
  const d = {
    autoSync: $('st_autoSync').checked,
    callerEmails: $('st_callers').value.trim(),
    taskOwners: $('st_taskOwners').value.trim() || 'Apo,Marga',
    gcalApiKey: $('st_gcalKey').value.trim(),
    gcalClientId: $('st_gcalClient').value.trim(),
    gcalCalendarId: $('st_gcalId').value.trim(),
    goalQuarterRevenue: parseNum($('st_goalQ').value),
    retentionMonths: Math.round(parseNum($('st_retention').value)),
    taxPrepayPct: parseNum($('st_taxPrepay').value) || 80,
    appointmentFee: parseNum($('st_apptFee').value) || 50,
    autoReport: $('st_autoReport').checked,
    autoCharge: $('st_autoCharge').checked,
    metaToken: $('st_metaToken').value.trim(),
    metaAccount: $('st_metaAccount').value.trim(),
  };
  try {
    if (S.settings) await data.update('settings', 'main', d);
    else await data.create('settings', d, 'main');
    toast('Οι ρυθμίσεις αποθηκεύτηκαν.');
    await refresh();
  } catch (e) { toast('Η αποθήκευση απέτυχε: ' + e.message); }
};
$('btnNotifEnable').onclick = async () => {
  if (typeof Notification === 'undefined') { toast('Ο browser δεν υποστηρίζει ειδοποιήσεις.'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    try { localStorage.setItem('astra_notif', '1'); } catch { /* storage blocked */ }
    browserNotify('Οι ειδοποιήσεις είναι ενεργές', 'Θα ενημερώνεσαι για νέα leads σε αυτή τη συσκευή.');
    toast('Ειδοποιήσεις ενεργές ✓');
  } else toast('Δεν δόθηκε άδεια για ειδοποιήσεις.');
  renderSettings();
};
function trashLabel(t) {
  const b = t.body || {};
  return b.name || b.title || b.description || b.category || t.docId;
}
function renderTrash() {
  const rows = (S.trash || []).slice(0, 15);
  $('trashList').innerHTML = rows.length
    ? rows.map((t) => `<div class="trashrow" data-id="${t.id}">
        <span class="stype srctag">${COLL_LABEL[t.coll] || t.coll}</span>
        <span>${esc(trashLabel(t))}</span>
        <span class="tmeta">${new Date(t.deletedAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</span>
        <button class="btn small" data-act="restore">Επαναφορά</button>
      </div>`).join('')
    : '<div class="fhint">Ο κάδος είναι άδειος.</div>';
}
$('trashList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act=restore]'); if (!b) return;
  const id = b.closest('.trashrow').dataset.id;
  const t = S.trash.find((x) => x.id === id); if (!t) return;
  b.disabled = true;
  try {
    await data.create(t.coll, t.body, t.docId);
    await data.remove('trash', id);
    toast((COLL_LABEL[t.coll] || '') + ' «' + trashLabel(t) + '» επαναφέρθηκε.');
    await refresh();
  } catch (err) { toast('Η επαναφορά απέτυχε: ' + err.message); b.disabled = false; }
});
$('btnBackup').onclick = async () => {
  try {
    const all = await data.loadAll();
    downloadJSON('astra-backup-' + todayISO() + '.json', { exportedAt: new Date().toISOString(), backend: data.BACKEND, ...all });
    toast('Το backup κατέβηκε.');
  } catch (e) { toast('Το backup απέτυχε: ' + e.message); }
};
$('btnGcalReconnect').onclick = async () => {
  const b = $('btnGcalReconnect'); b.disabled = true;
  try {
    await gcal.connectPermanent(gcalClient());
    Object.keys(gcalCache).forEach((k) => delete gcalCache[k]);
    toast('Η σύνδεση Google ανανεώθηκε με πλήρη δικαιώματα — για όλη την ομάδα, για πάντα ✓');
  } catch (e) { toast(e.message); }
  b.disabled = false;
};
/* ============ OVERVIEW ============ */
function renderOverview() {
  const mk = nowMonth();
  const prev = lastMonths(2)[0];
  $('ovSub').textContent = new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const leadsM = S.leads.filter((l) => monthKey(l.createdTime) === mk).length;
  const leadsP = S.leads.filter((l) => monthKey(l.createdTime) === prev).length;
  const spendM = S.camps.filter((c) => c.month === mk).reduce((s, c) => s + (+c.spend || 0), 0);
  const salesM = S.leads.filter((l) => l.status === 'won' && monthKey(l.saleDate || l.createdTime) === mk);
  const revM = salesM.reduce((s, l) => s + (+l.amount || 0), 0);
  const roas = spendM > 0 ? revM / spendM : 0;
  const incM = S.fin.filter((f) => f.kind === 'income' && monthKey(f.date) === mk).reduce((s, f) => s + (+f.net || 0), 0);
  const expM = S.fin.filter((f) => f.kind === 'expense' && monthKey(f.date) === mk).reduce((s, f) => s + (+f.net || 0), 0);
  const delta = leadsP ? Math.round(100 * (leadsM - leadsP) / leadsP) : null;
  $('ovTiles').innerHTML = `
    <div class="tile"><div class="lb">Leads · ${mLabel(mk)}</div><div class="v">${leadsM}</div><div class="d">${delta === null ? '—' : `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%</span> vs ${mLabel(prev)}`}</div></div>
    <div class="tile"><div class="lb">Ad spend · ${mLabel(mk)}</div><div class="v">${eur(spendM)}</div><div class="d">από ${S.camps.filter((c) => c.month === mk).length} καμπάνιες</div></div>
    <div class="tile"><div class="lb">Έσοδα πωλήσεων πελατών</div><div class="v">${eur(revM)}</div><div class="d">${salesM.length} πωλήσεις τον μήνα</div></div>
    <div class="tile"><div class="lb">ROAS μήνα</div><div class="v ${spendM > 0 ? (roas >= 2 ? 'pos' : roas < 1 ? 'neg' : '') : ''}">${spendM > 0 ? roas.toFixed(2) + '×' : '—'}</div><div class="d">έσοδα ÷ δαπάνη</div></div>
    ${(() => { const t = taxEstimate(); return `<div class="tile"><div class="lb">Κέρδος Astra · ${mLabel(mk)}</div><div class="v ${t.profitM >= 0 ? 'pos' : 'neg'}">${eur(t.profitM)}</div><div class="d">τζίρος ${eur(t.revM)} (${t.apptM} ραντεβού × ${eur(apptFee())}) − έξοδα ${eur(t.expMn)}</div></div>`; })()}
    <div class="tile"><div class="lb">Ενεργές κλινικές</div><div class="v">${S.clinics.length}</div><div class="d">${S.clinics.filter((c) => c.sheetId).length} με συνδεδεμένο sheet</div></div>
    ${(() => {
      const t = taxEstimate();
      return `<div class="tile"><div class="lb">ΦΠΑ ${mLabel(t.mk)}</div><div class="v ${t.vatMonth > 0 ? 'neg' : 'pos'}">${eur(t.vatMonth)}</div><div class="d">${t.vatMonth > 0 ? 'για απόδοση' : 'πιστωτικό'} · φόρος έτους ${eur(t.tax + t.prepay)}</div></div>`;
    })()}
    ${(() => {
      const g = +SET().goalQuarterRevenue || 0; if (!g) return '';
      const qk = quarterOf(new Date().toISOString());
      const qInc = S.fin.filter((f) => f.kind === 'income' && quarterOf(f.date) === qk).reduce((s, f) => s + (+f.net || 0), 0);
      const pct = Math.min(100, Math.round(100 * qInc / g));
      return `<div class="tile"><div class="lb">Στόχος τριμήνου</div><div class="v ${pct >= 100 ? 'pos' : ''}">${pct}%</div><div class="d">${eur(qInc)} από ${eur(g)}</div></div>`;
    })()}`;
  $('ovFunnel').innerHTML = S.leads.length ? funnelHTML(S.leads) : '';
  const months = lastMonths(6);
  const spendBy = months.map((m) => S.camps.filter((c) => c.month === m).reduce((s, c) => s + (+c.spend || 0), 0));
  const revBy = months.map((m) => S.leads.filter((l) => l.status === 'won' && monthKey(l.saleDate || l.createdTime) === m).reduce((s, l) => s + (+l.amount || 0), 0));
  const leadsBy = months.map((m) => S.leads.filter((l) => monthKey(l.createdTime) === m).length);
  $('chartSpendRev').innerHTML = groupedBars(months, [{ name: 'Ad spend', vals: spendBy, color: 'var(--c1)' }, { name: 'Έσοδα πωλήσεων', vals: revBy, color: 'var(--c3)' }], (v) => eur(v));
  $('chartLeads').innerHTML = groupedBars(months, [{ name: 'Leads', vals: leadsBy, color: 'var(--c2)' }], (v) => num(v) + ' leads');
  renderSources();
  renderFeed();
  renderTeam();
  renderContractsPanel();
  const alerts = [];
  const { due, fresh } = todayItems();
  if (due.length) alerts.push({ cls: 'crit', ic: '!', txt: `${due.length} προγραμματισμένες ενέργειες είναι για σήμερα ή έχουν περάσει — δες το tab «Σήμερα».` });
  if (fresh.length) alerts.push({ cls: 'warn', ic: '!', txt: `${fresh.length} νέα leads περιμένουν πάνω από 48 ώρες χωρίς επικοινωνία.` });
  S.camps.filter((c) => c.month === mk && c.spend > 0).forEach((c) => {
    const ls = campLeads(c); const rev = ls.filter((l) => l.status === 'won').reduce((s, l) => s + (+l.amount || 0), 0);
    if (c.spend > 100 && rev / c.spend < 1 && ls.length) alerts.push({ cls: 'crit', ic: '▼', txt: `Η καμπάνια «${c.name}» τρέχει με ROAS ${(rev / c.spend).toFixed(2)}× αυτόν τον μήνα.` });
    if (!ls.length && c.spend > 50) alerts.push({ cls: 'warn', ic: '!', txt: `Η καμπάνια «${c.name}» έχει δαπάνη ${eur(c.spend)} χωρίς κανένα αντιστοιχισμένο lead — έλεγξε ότι το όνομα ταιριάζει με το Meta.` });
  });
  const { stale } = todayItems();
  if (stale.length) alerts.push({ cls: 'warn', ic: '!', txt: `${stale.length} leads είναι ξεχασμένα 21+ μέρες — δες το τέλος του tab «Σήμερα».` });
  S.clinics.forEach((c) => {
    if (+c.monthlyBudget > 0) {
      const sp = S.camps.filter((x) => x.clinicId === c.id && x.month === mk).reduce((s, x) => s + (+x.spend || 0), 0);
      if (sp > +c.monthlyBudget) alerts.push({ cls: 'crit', ic: '▼', txt: `Η «${c.name}» ξεπέρασε το μηνιαίο budget: ${eur(sp)} από ${eur(+c.monthlyBudget)}.` });
      else if (sp > 0.9 * +c.monthlyBudget) alerts.push({ cls: 'warn', ic: '!', txt: `Η «${c.name}» είναι στο ${Math.round(100 * sp / +c.monthlyBudget)}% του μηνιαίου budget.` });
    }
    const d = contractDays(c);
    if (d === null) return;
    if (d < 0) alerts.push({ cls: 'crit', ic: '▼', txt: `Το συμβόλαιο της «${c.name}» έχει λήξει — μίλησε για ανανέωση.` });
    else if (d <= 30) alerts.push({ cls: 'warn', ic: '!', txt: `Το συμβόλαιο της «${c.name}» λήγει σε ${d} μέρες.` });
  });
  subsDue().forEach((s) => {
    const d = subDays(s), what = `Η ετήσια συνδρομή «${subName(s)}${s.description ? ' · ' + s.description : ''}»`;
    if (d < 0) alerts.push({ cls: 'crit', ic: '▼', txt: `${what} έπρεπε να ανανεωθεί πριν ${-d} μέρες — Οικονομικά → Ετήσιες συνδρομές.` });
    else alerts.push({ cls: 'warn', ic: '!', txt: `${what} ανανεώνεται ${d === 0 ? 'σήμερα' : 'σε ' + d + ' μέρες'}.` });
  });
  {
    const pm = lastMonths(2)[0];
    const a = S.acct.find((x) => x.id === pm);
    if (S.fin.some((f) => monthKey(f.date) === pm) && (!a || a.status !== 'sent')) {
      alerts.push({ cls: 'warn', ic: '!', txt: `Τα έξοδα ${mLabel(pm)} δεν έχουν σταλεί στον λογιστή — Οικονομικά → Λογιστής.` });
    }
  }
  const failedPays = S.billing.filter((x) => x.period === 'week' && x.payStatus === 'failed');
  if (failedPays.length) alerts.push({ cls: 'crit', ic: '▼', txt: `${failedPays.length} αποτυχημένες χρεώσεις SEPA (${failedPays.map((x) => x.clinicName).join(', ')}) — Οικονομικά → Εβδομαδιαίες χρεώσεις.` });
  const noMandate = S.clinics.filter((c) => (c.status || 'active') === 'active' && c.sepaStatus !== 'active');
  if (noMandate.length && S.billing.some((x) => x.period === 'week')) alerts.push({ cls: 'warn', ic: '!', txt: `${noMandate.length} ενεργοί πελάτες χωρίς πάγια εντολή SEPA — στείλε σύνδεσμο εντολής.` });
  if (dupGroups().length) alerts.push({ cls: 'warn', ic: '!', txt: `${dupGroups().length} πιθανά διπλά leads — δες το banner στο tab Leads.` });
  const noSheet = S.clinics.filter((c) => !c.sheetId);
  if (noSheet.length && S.clinics.length) alerts.push({ cls: 'warn', ic: '!', txt: `${noSheet.length === 1 ? 'Η κλινική ' + noSheet[0].name + ' δεν έχει' : noSheet.length + ' κλινικές δεν έχουν'} συνδεδεμένο Google Sheet leads.` });
  if (!S.clinics.length) alerts.push({ cls: 'ok', ic: '→', txt: 'Ξεκίνα από το tab «Κλινικές»: πρόσθεσε τον πρώτο σου πελάτη και σύνδεσε το sheet των leads όταν ετοιμαστεί.' });
  if (!alerts.length) alerts.push({ cls: 'ok', ic: '✓', txt: 'Όλα καλά — κανένα εκκρεμές follow-up και καμία καμπάνια σε κόκκινο.' });
  $('ovAlerts').innerHTML = alerts.map((a) => `<div class="alertrow ${a.cls}"><span class="ic">${a.ic}</span><span>${esc(a.txt)}</span></div>`).join('');
}
const GR_DOW = ['Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ'];
function renderSources() {
  const ls = S.leads.filter((l) => l.createdTime);
  const won = (l) => l.status === 'won';
  // πλατφόρμες
  const plats = [['fb', 'Facebook'], ['ig', 'Instagram'], ['manual', 'Χειροκίνητα']];
  const other = ls.filter((l) => !plats.some(([k]) => l.platform === k));
  $('platformTiles').innerHTML = !ls.length ? '' : plats.map(([k, name]) => {
    const g = ls.filter((l) => l.platform === k);
    if (!g.length) return '';
    const w = g.filter(won).length;
    return `<div class="tile"><div class="lb">${name}</div><div class="v">${g.length}</div><div class="d">${w} πωλήσεις · ${Math.round(100 * w / g.length)}% conv.</div></div>`;
  }).join('') + (other.length ? `<div class="tile"><div class="lb">Άλλο</div><div class="v">${other.length}</div><div class="d">${other.filter(won).length} πωλήσεις</div></div>` : '');
  // ημέρα εβδομάδας
  const dow = (l) => { const d = new Date(l.createdTime); return isNaN(d) ? null : (d.getDay() + 6) % 7; };
  const wdL = [0, 0, 0, 0, 0, 0, 0], wdW = [0, 0, 0, 0, 0, 0, 0];
  ls.forEach((l) => { const i = dow(l); if (i === null) return; wdL[i]++; if (won(l)) wdW[i]++; });
  $('chartWeekday').innerHTML = groupedBars([0, 1, 2, 3, 4, 5, 6],
    [{ name: 'Leads', vals: wdL, color: 'var(--c2)' }, { name: 'Πωλήσεις', vals: wdW, color: 'var(--c3)' }],
    (v) => num(v), (i) => GR_DOW[i]);
  // ώρες (3ωρα)
  const hL = [0, 0, 0, 0, 0, 0, 0, 0], hW = [0, 0, 0, 0, 0, 0, 0, 0];
  ls.forEach((l) => { const d = new Date(l.createdTime); if (isNaN(d)) return; const b = Math.floor(d.getHours() / 3); hL[b]++; if (won(l)) hW[b]++; });
  const HB = ['00', '03', '06', '09', '12', '15', '18', '21'];
  $('chartHours').innerHTML = groupedBars([0, 1, 2, 3, 4, 5, 6, 7],
    [{ name: 'Leads', vals: hL, color: 'var(--c2)' }, { name: 'Πωλήσεις', vals: hW, color: 'var(--c3)' }],
    (v) => num(v), (i) => HB[i] + '-' + (HB[(i + 1) % 8] === '00' ? '24' : HB[(i + 1) % 8]));
}
function renderFeed() {
  const rows = S.act.slice(0, 15);
  $('ovFeed').innerHTML = rows.length ? rows.map((a) => {
    const l = leadById(a.leadId);
    const d = new Date(a.at);
    return `<div class="feedrow"><span class="at">${d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span><span>${a.by ? '<b>' + esc(a.by.split('@')[0]) + '</b> · ' : ''}${l ? esc(l.name) + ': ' : ''}${esc(a.body)}</span></div>`;
  }).join('') : '<div class="empty" style="padding:20px">Καμία καταγεγραμμένη ενέργεια ακόμα.</div>';
}
function speedToLead(clinicId) {
  const cut = Date.now() - 30 * 86400000;
  const firstAct = {};
  for (const a of S.act) {
    if (['import', 'create'].includes(a.type)) continue;
    const t = new Date(a.at).getTime();
    if (!firstAct[a.leadId] || t < firstAct[a.leadId]) firstAct[a.leadId] = t;
  }
  const diffs = [];
  for (const l of S.leads) {
    if (clinicId && l.clinicId !== clinicId) continue;
    const born = new Date(l.importedAt || l.createdTime || 0).getTime();
    if (!born || born < cut) continue;
    const f = firstAct[l.id];
    if (f && f > born) diffs.push((f - born) / 60000);
  }
  if (!diffs.length) return null;
  const avg = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  return { avg, n: diffs.length };
}
const fmtMins = (m) => m >= 60 ? Math.floor(m / 60) + 'ω ' + Math.round(m % 60) + '′' : Math.round(m) + '′';
function renderTeam() {
  const sp = speedToLead(null);
  const spHtml = sp
    ? `<div class="alertrow ${sp.avg <= 30 ? 'ok' : sp.avg <= 240 ? 'warn' : 'crit'}"><span class="ic">⚡</span><span><b>Ταχύτητα 1ης ενέργειας: ${fmtMins(sp.avg)}</b> κατά μέσο όρο (${sp.n} leads, 30 ημέρες). ${sp.avg <= 30 ? 'Εξαιρετικά — κάτω από 30′.' : 'Στόχος: κάτω από 30′ — τα γρήγορα leads κλείνουν ραντεβού.'}</span></div>`
    : '';
  if (spHtml) { /* μπαίνει πάνω από τον πίνακα ομάδας */ }
  const cut = Date.now() - 7 * 24 * 3600 * 1000;
  const acts = S.act.filter((a) => new Date(a.at).getTime() > cut);
  const by = {};
  acts.forEach((a) => { const k = a.by || '—'; by[k] = by[k] || { total: 0, status: 0, note: 0, next: 0 }; by[k].total++; if (by[k][a.type] !== undefined) by[k][a.type]++; });
  const keys = Object.keys(by).sort((a, b) => by[b].total - by[a].total);
  $('teamTable').innerHTML = spHtml + (keys.length
    ? '<table><thead><tr><th>Μέλος</th><th class="num">Ενέργειες</th><th class="num">Αλλαγές σταδίου</th><th class="num">Σχόλια</th><th class="num">Follow-ups</th></tr></thead><tbody>'
      + keys.map((k) => `<tr><td><b>${esc(k === '—' ? 'Χωρίς όνομα' : k.split('@')[0])}</b></td><td class="num">${by[k].total}</td><td class="num">${by[k].status}</td><td class="num">${by[k].note}</td><td class="num">${by[k].next}</td></tr>`).join('')
      + '</tbody></table>'
    : '<div class="empty" style="padding:20px">Καμία δραστηριότητα τις τελευταίες 7 ημέρες.</div>');
}
function renderContractsPanel() {
  const soon = S.clinics.map((c) => [c, contractDays(c)]).filter(([, d]) => d !== null && d <= 45).sort((a, b) => a[1] - b[1]);
  $('ovContracts').innerHTML = soon.length
    ? '<div class="card">' + soon.map(([c, d]) => `<div class="alertrow ${d < 15 ? 'crit' : 'warn'}"><span class="ic">${d < 0 ? '▼' : '!'}</span><span>Συμβόλαιο «${esc(c.name)}» ${d < 0 ? 'έληξε πριν ' + Math.abs(d) + ' μέρες' : 'λήγει σε ' + d + ' μέρες'} — ανανέωση από την καρτέλα της κλινικής.</span></div>`).join('') + '</div>'
    : '';
}

/* grouped bar chart — μία κλίμακα, τιμές σε αναλογία, hover tooltips */
function groupedBars(months, series, fmt, lbl = mLabel) {
  const W = 560, H = 210, padL = 44, padR = 10, padT = 12, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...series.flatMap((s) => s.vals));
  const nice = niceMax(max);
  const y = (v) => padT + ih - (v / nice) * ih;
  const groups = months.length, gw = iw / groups;
  const bw = Math.min(26, (gw - 12) / series.length);
  let bars = '', labels = '', grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = nice * g / 4; const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--hair2)" stroke-width="1"/>`
      + `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${shortNum(v)}</text>`;
  }
  months.forEach((m, i) => {
    const cx = padL + gw * i + gw / 2;
    labels += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(lbl(m))}</text>`;
    series.forEach((s, j) => {
      const v = s.vals[i]; const x = cx - (series.length * bw + 2 * (series.length - 1)) / 2 + j * (bw + 2);
      const hh = Math.max(v > 0 ? 2 : 0, (v / nice) * ih);
      bars += `<rect class="bar" x="${x}" y="${y(v)}" width="${bw}" height="${hh}" rx="3" fill="${s.color}" data-tip="${esc(lbl(m) + ' · ' + s.name + '\n' + fmt(v))}"/>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} ανά μήνα">${grid}${bars}${labels}</svg>`;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const d = v / p; const n = d <= 1 ? 1 : d <= 2 ? 2 : d <= 4 ? 4 : d <= 5 ? 5 : d <= 8 ? 8 : 10; return n * p; }
function shortNum(v) { if (v >= 1000) return (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k'; return String(Math.round(v)); }
const tip = $('tooltip');
document.body.addEventListener('mousemove', (e) => {
  const b = e.target.closest && e.target.closest('.bar');
  if (b) { tip.textContent = b.dataset.tip; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 12, innerWidth - 160) + 'px'; tip.style.top = (e.clientY - 40) + 'px'; }
  else tip.style.display = 'none';
});

/* ============ render root ============ */
function renderAll() {
  updateTodayBadge();
  if (activeTab === 'clinic') { renderClinicView(); return; }
  if (activeTab === 'today') renderToday();
  if (activeTab === 'tasks') renderTasks();
  if (activeTab === 'overview') renderOverview();
  if (activeTab === 'clinics') renderClinics();
  if (activeTab === 'leads') renderLeads();
  if (activeTab === 'calendar') renderCalendar();
  if (activeTab === 'campaigns') { renderCamps(); renderCreatives(); }
  if (activeTab === 'finance') renderFin();
  if (activeTab === 'reports') { renderReport(); renderStatsArchive(); }
  if (activeTab === 'settings') renderSettings();
}
$('btnRefresh').onclick = refresh;
/* Σε cloud mode, ήπιο auto-refresh για να βλέπει η ομάδα τις αλλαγές των άλλων. */
if (CONFIG.backend === 'supabase') setInterval(refresh, 60_000);

initTab();
renderAll();
refresh();

/* ---- Αλλαγή κωδικού ---- */
document.getElementById('pwSave').addEventListener('click', async () => {
  const a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
  const say = (m) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4200); };
  if (a.length < 10 || !/[A-Za-zΑ-Ωα-ω]/.test(a) || !/\d/.test(a)) { say('Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες, με γράμματα και αριθμούς.'); return; }
  if (a !== b) { say('Οι δύο κωδικοί δεν ταιριάζουν.'); return; }
  try { await updatePassword(a); document.getElementById('pw1').value = ''; document.getElementById('pw2').value = ''; say('Ο κωδικός άλλαξε ✓'); }
  catch (e) { say(e.message); }
});
