// shared/gdrive.js — αποθήκευση backup στο Drive (drive.file scope, μόνιμη σύνδεση).
import { ensureToken } from './gcal.js';

export async function uploadJsonToDrive(clientId, filename, obj) {
  const token = await ensureToken(clientId);
  const boundary = 'astraB' + Date.now().toString(36);
  const meta = JSON.stringify({ name: filename, mimeType: 'application/json' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error && j.error.message ? 'Drive: ' + j.error.message : 'Backup Drive απέτυχε (' + r.status + ')'); }
  return (await r.json()).id;
}

/* ---- Αποδείξεις / τιμολόγια: φάκελος στο Drive με υποφάκελο ανά μήνα ---- */
const API = 'https://www.googleapis.com/drive/v3/files';
const ALL = 'supportsAllDrives=true';
const FOLDER = 'application/vnd.google-apps.folder';
export const RECEIPTS_FOLDER = 'Αποδείξεις / Τιμολόγια';
const SHARED_DRIVE_ID = '0AIBApQdfHfqdUk9PVA'; // shared drive «ASTRA MARKETING»

async function gd(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Drive: ' + ((j.error && j.error.message) || r.status));
  return j;
}
async function findFolder(token, name, parent) {
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false` + (parent ? ` and '${parent}' in parents` : '');
  const base = `${API}?q=${encodeURIComponent(q)}&fields=files(id)`;
  const j = await gd(token, `${base}&corpora=allDrives&includeItemsFromAllDrives=true&${ALL}`).catch(() => gd(token, base));
  return j.files && j.files[0] ? j.files[0].id : null;
}
const makeFolder = (token, name, parent) => gd(token, `${API}?fields=id&${ALL}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
}).then((j) => j.id);

let rootId = null;
const monthIds = {};
/* Ο κεντρικός φάκελος μπαίνει στο shared drive· αν το Google δεν το επιτρέψει στο app, στο My Drive του συνδεδεμένου λογαριασμού. */
async function receiptsFolder(token, month) {
  if (!rootId) {
    rootId = await findFolder(token, RECEIPTS_FOLDER);
    if (!rootId) {
      try { rootId = await makeFolder(token, RECEIPTS_FOLDER, SHARED_DRIVE_ID); }
      catch { rootId = await makeFolder(token, RECEIPTS_FOLDER); }
    }
  }
  if (!monthIds[month]) monthIds[month] = (await findFolder(token, month, rootId)) || (await makeFolder(token, month, rootId));
  return monthIds[month];
}

/* Ανεβάζει ένα αρχείο στον φάκελο του μήνα. Επιστρέφει { id, link, folderId }. */
export async function uploadReceipt(clientId, month, file) {
  const token = await ensureToken(clientId);
  const folderId = await receiptsFolder(token, month);
  const b = 'astraR' + Date.now().toString(36);
  const type = file.type || 'application/octet-stream';
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: file.name, parents: [folderId] })}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`,
    file, `\r\n--${b}--`,
  ]);
  const j = await gd(token, `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&${ALL}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body,
  });
  return { id: j.id, link: j.webViewLink || '', folderId };
}

/* Στέλνει το αρχείο στον κάδο του Drive (ανακτήσιμο 30 ημέρες). */
export async function trashReceipt(clientId, fileId) {
  const token = await ensureToken(clientId);
  await gd(token, `${API}/${encodeURIComponent(fileId)}?${ALL}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}
