// shared/supabase.js — μικρός client για Supabase Auth + PostgREST, χωρίς SDK/βήμα build.
// Session στο localStorage· αυτόματο refresh λίγο πριν τη λήξη.
import { CONFIG } from './config.js';

const KEY = 'astra_session';
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage blocked */ }

export function getSession() { return session; }

function storeSession(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

async function authCall(path, body) {
  const r = await fetch(`${CONFIG.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Auth error');
  return j;
}

export async function signIn(email, password) {
  const j = await authCall('token?grant_type=password', { email, password });
  storeSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, email: j.user && j.user.email });
  return session;
}

export function signOut() { storeSession(null); }

async function ensureFresh() {
  if (!session) throw new Error('no-session');
  if (session.expires_at && session.expires_at * 1000 - Date.now() > 60_000) return;
  try {
    const j = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    storeSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, email: j.user && j.user.email });
  } catch (e) {
    storeSession(null);
    throw new Error('session-expired');
  }
}

/* Αλλαγή κωδικού του συνδεδεμένου χρήστη. */
export async function updatePassword(newPassword) {
  await ensureFresh();
  const r = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.error_description || j.message || 'Η αλλαγή κωδικού απέτυχε');
}

/* Κλήση Supabase Edge Function με τα δικαιώματα του συνδεδεμένου χρήστη. */
export async function callFunction(name, body) {
  await ensureFresh();
  const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Σφάλμα function (' + r.status + ')');
  return j;
}

/* ---- Storage (private buckets, με τα δικαιώματα του συνδεδεμένου χρήστη) ---- */
export async function storageUpload(bucket, path, file) {
  await ensureFresh();
  const r = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
    body: file,
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('Το ανέβασμα απέτυχε: ' + t.slice(0, 140)); }
}
export async function storageDownload(bucket, path) {
  await ensureFresh();
  const r = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/authenticated/${bucket}/${path}`, {
    headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${session.access_token}` },
  });
  if (!r.ok) throw new Error('Το κατέβασμα απέτυχε (' + r.status + ')');
  return r.blob();
}
export async function storageDelete(bucket, path) {
  await ensureFresh();
  const r = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${session.access_token}` },
  });
  if (!r.ok) throw new Error('Η διαγραφή αρχείου απέτυχε (' + r.status + ')');
}

/* REST κλήση στο PostgREST. path π.χ. 'leads?select=*&order=created_time.desc' */
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  await ensureFresh();
  const headers = {
    apikey: CONFIG.supabaseKey,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    Prefer: prefer || (method === 'GET' ? '' : 'return=representation'),
  };
  if (!headers.Prefer) delete headers.Prefer;
  const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { storeSession(null); throw new Error('session-expired'); }
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`); }
  if (r.status === 204) return null;
  return r.json();
}
