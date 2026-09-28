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
