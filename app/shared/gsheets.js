// shared/gsheets.js — εγγραφή των εξόδων/εσόδων του μήνα στο Google Sheet του λογιστή.
// Χρησιμοποιεί την ίδια μόνιμη σύνδεση Google (gcal-auth) — κανένα ξεχωριστό login.
import { ensureToken } from './gcal.js';

export function spreadsheetIdFrom(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

/* Γράφει τον πίνακα values (array of arrays) στο sheet, από το κελί A1 του πρώτου φύλλου.
   Το ίδιο μπλοκ ξαναγράφεται σε επανάληψη — δεν δημιουργούνται διπλές γραμμές. */
export async function writeToSheet(clientId, spreadsheetId, values) {
  const token = await ensureToken(clientId);
  const range = encodeURIComponent('A1');
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: 'A1', majorDimension: 'ROWS', values }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error('Χωρίς δικαίωμα στο sheet — ο λογαριασμός Google της σύνδεσης πρέπει να έχει edit πρόσβαση (ή ξανασυνδέσου για να προστεθεί το δικαίωμα Sheets).');
  if (r.status === 404) throw new Error('Το sheet δεν βρέθηκε — έλεγξε το link.');
  if (!r.ok) throw new Error(j.error && j.error.message ? 'Google Sheets: ' + j.error.message : 'Σφάλμα εγγραφής στο sheet (' + r.status + ')');
  return j.updatedCells || 0;
}

/* Ανάγνωση ΙΔΙΩΤΙΚΟΥ sheet μέσω Sheets API (μόνιμη σύνδεση Google) — rows όπως το CSV. */
export async function readSheetValues(clientId, spreadsheetId, gid) {
  const token = await ensureToken(clientId);
  // Με gid στο link διαβάζουμε το συγκεκριμένο φύλλο (όχι πάντα το πρώτο).
  let range = 'A1:Z20000';
  if (gid) {
    const m = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`, {
      headers: { Authorization: 'Bearer ' + token },
    }).then((x) => x.json()).catch(() => ({}));
    const sh = (m.sheets || []).find((x) => String(x.properties?.sheetId) === String(gid));
    if (sh) range = `'${sh.properties.title.replace(/'/g, "''")}'!A1:Z20000`;
  }
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 || r.status === 404) throw new Error('Το sheet δεν διαβάζεται — δώσε πρόσβαση στον λογαριασμό Google της σύνδεσης.');
  if (!r.ok) throw new Error(j.error && j.error.message ? 'Sheets: ' + j.error.message : 'Σφάλμα ανάγνωσης sheet (' + r.status + ')');
  return (j.values || []).filter((row) => row.some((x) => String(x).trim() !== ''));
}
