// shared/sheets.js — import leads από Google Sheets (Meta lead forms export).
// Διαβάζει το sheet ως CSV από το gviz endpoint· δουλεύει όταν το sheet είναι
// «Anyone with the link → Viewer». Εναλλακτικά, τα ίδια mapping δουλεύουν και για ανέβασμα αρχείου CSV.

export function sheetIdFrom(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}
export function gidFrom(url) {
  const m = String(url || '').match(/[#&?]gid=(\d+)/);
  return m ? m[1] : null;
}

export async function fetchSheetCSV(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gid ? '&gid=' + gid : ''}`;
  let r;
  try { r = await fetch(url); }
  catch { throw new Error('Δεν ήταν δυνατή η σύνδεση με το Google Sheets. Έλεγξε τη σύνδεση και ότι το sheet είναι «Anyone with the link → Viewer».'); }
  const text = await r.text();
  if (!r.ok || /^\s*</.test(text)) {
    throw new Error('Το sheet δεν διαβάζεται. Στο Google Sheet: Share → General access → «Anyone with the link» → Viewer.');
  }
  return text;
}

/* CSV parser με υποστήριξη quotes. */
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/* Χαρτογράφηση στηλών Meta lead export → leads της εφαρμογής.
   Επιστρέφει rows έτοιμα για upsertLeads (με σταθερό id για dedupe). */
/* Ημερομηνία από sheet → ISO. Δέχεται serial number των Sheets, ISO, ή D/M/YYYY [HH:mm[:ss]]. */
export function sheetDateToISO(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') { // serial των Sheets = τοπική ώρα του sheet (Ελλάδα), όχι UTC
    const u = new Date(Math.round((v - 25569) * 86400000));
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds()).toISOString();
  }
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return t;
  const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isNaN(d) ? t : d.toISOString();
}
const STATUS_EL = [
  [/^νέο/, 'neo'], [/δεν απάντησε|ξανακαλ|μιλήσαμε|κλήθηκ/, 'epik'],
  [/ραντεβού κλείστηκε|κλείστηκε/, 'rv'], [/^ήρθε/, 'show'], [/δεν ήρθε|ακυρ|χαμέν|όχι ενδιαφ/, 'lost'],
  [/έκλεισε πακέτο|πακέτο/, 'won'],
];
function statusFromEl(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return 'neo';
  for (const [re, st] of STATUS_EL) if (re.test(t)) return st;
  return 'neo';
}

/* Στήλες: Meta lead-form export (id, created_time, full_name, phone_number…) Ή ελληνικό sheet
   φόρμας landing (Ημερομηνία, Lead ID, Προσφορά, Όνομα, Τηλέφωνο, Email, Πότε…, Μπορεί…, Κατάσταση,
   Ημ/νία ραντεβού, Πακέτο, Αξία πακέτου). Δοκιμαστικές γραμμές (TEST-…, ΔΟΚΙΜΗ) αγνοούνται. */
export function mapLeads(rows, clinicId) {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const colStarts = (...prefixes) => header.findIndex((h) => prefixes.some((p) => h.startsWith(p)));
  const iId = col('id', 'lead id', 'lead_id'), iCr = col('created_time', 'ημερομηνία', 'date'),
    iAd = col('ad_name', 'διαφήμιση', 'ad'), iCamp = col('campaign_name', 'καμπάνια', 'campaign'),
    iPlat = col('platform'), iMail = col('email', 'e-mail'), iName = col('full_name', 'όνομα', 'name', 'ονοματεπώνυμο'),
    iPhone = col('phone_number', 'τηλέφωνο', 'phone', 'κινητό');
  const iNotes = header.findIndex((h) => h.includes('σημει') || h === 'notes');
  const iOffer = col('προσφορά'), iWhen = colStarts('πότε'), iCan = colStarts('μπορεί'),
    iStatus = col('κατάσταση', 'status'), iAppt = colStarts('ημ/νία ραντεβού', 'ημερομηνία ραντεβού'),
    iPack = col('πακέτο'), iAmount = colStarts('αξία');
  if (iId < 0 && iName < 0 && iPhone < 0) {
    throw new Error('Το sheet δεν έχει τις αναμενόμενες στήλες (id/Lead ID, full_name/Όνομα, phone_number/Τηλέφωνο…).');
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const g = (i) => (i >= 0 && i < r.length && r[i] != null ? String(r[i]).trim() : '');
    const rawId = g(iId), name = g(iName), phone = g(iPhone).replace(/^p:/, ''), email = g(iMail);
    if (!rawId && !name && !phone) continue;
    if (/^test[-_]/i.test(rawId) || /δοκιμη|δοκιμή|^test\b/i.test(name)) continue;
    const id = (rawId || 'x' + (phone || email || name).replace(/\W/g, '').slice(-24))
      .replace(/[^A-Za-z0-9_\-.~:@+]/g, '-').slice(0, 180);
    const extra = [];
    if (g(iOffer)) extra.push('Προσφορά: ' + g(iOffer));
    if (g(iWhen)) extra.push('Πότε: ' + g(iWhen));
    if (iCan >= 0 && g(iCan)) extra.push(rows[0][iCan].trim() + ': ' + g(iCan));
    const sheetNotes = [g(iNotes), ...extra].filter(Boolean).join(' · ');
    const pack = /^ναι|^yes/i.test(g(iPack));
    const amount = parseFloat(String(g(iAmount)).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    const status = pack ? 'won' : statusFromEl(g(iStatus));
    const appt = g(iAppt) ? sheetDateToISO(iAppt >= 0 ? r[iAppt] : '').slice(0, 10) : '';
    const created = iCr >= 0 ? sheetDateToISO(r[iCr]) : '';
    out.push({
      id, clinicId,
      name: name || '—', phone, email,
      createdTime: created || new Date().toISOString(),
      campaign: g(iCamp), adName: g(iAd), platform: g(iPlat) || (iOffer >= 0 ? 'site' : ''),
      sheetNotes, source: 'sheet',
      status, amount, notes: '',
      ...(appt ? { nextAction: appt } : {}),
      ...(status === 'won' ? { saleDate: appt || created.slice(0, 10) || new Date().toISOString().slice(0, 10) } : {}),
      importedAt: new Date().toISOString(),
    });
  }
  return out;
}
