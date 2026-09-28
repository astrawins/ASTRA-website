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
export function mapLeads(rows, clinicId) {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  const iId = col('id'), iCr = col('created_time'), iAd = col('ad_name'), iCamp = col('campaign_name'),
    iPlat = col('platform'), iMail = col('email'), iName = col('full_name'), iPhone = col('phone_number');
  const iNotes = header.findIndex((h) => h.includes('σημει') || h === 'notes');
  if (iId < 0 && iName < 0 && iPhone < 0) {
    throw new Error('Το sheet δεν έχει τις αναμενόμενες στήλες Meta (id, full_name, phone_number…).');
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const g = (i) => (i >= 0 && i < r.length ? String(r[i]).trim() : '');
    const rawId = g(iId), name = g(iName), phone = g(iPhone).replace(/^p:/, ''), email = g(iMail);
    if (!rawId && !name && !phone) continue;
    const id = (rawId || 'x' + (phone || email || name).replace(/\W/g, '').slice(-24))
      .replace(/[^A-Za-z0-9_\-.~:@+]/g, '-').slice(0, 180);
    out.push({
      id, clinicId,
      name: name || '—', phone, email,
      createdTime: g(iCr) || new Date().toISOString(),
      campaign: g(iCamp), adName: g(iAd), platform: g(iPlat),
      sheetNotes: g(iNotes), source: 'sheet',
      status: 'neo', amount: 0, notes: '',
      importedAt: new Date().toISOString(),
    });
  }
  return out;
}
