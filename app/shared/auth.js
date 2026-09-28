// shared/auth.js — ενιαία σύνδεση: Supabase Auth σε cloud mode, τοπικοί λογαριασμοί αλλιώς.
import { CONFIG, LOCAL_ACCOUNTS } from './config.js';
import { getSession as sbSession, signIn as sbSignIn, signOut as sbSignOut } from './supabase.js';

const LKEY = 'astra_local_session';

function localSession() {
  try { return JSON.parse(localStorage.getItem(LKEY)); } catch { return null; }
}

async function sha256hex(text) {
  if (crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return null; // μη-secure context (π.χ. http σε LAN IP) — δεν μπορεί να ελεγχθεί ο κωδικός
}

/* Συνεδρία, όποιο mode κι αν τρέχει. Επιστρέφει { email } ή null. */
export function currentSession() {
  if (CONFIG.backend === 'supabase') { const s = sbSession(); return s ? { email: s.email || '' } : null; }
  return localSession();
}

export async function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (CONFIG.backend === 'supabase') { await sbSignIn(email, password); return currentSession(); }
  const acc = LOCAL_ACCOUNTS.find((a) => a.email.toLowerCase() === email);
  if (!acc) throw new Error('invalid credentials');
  const h = await sha256hex(password);
  if (h === null) throw new Error('Η σύνδεση θέλει https ή localhost (ο browser δεν επιτρέπει έλεγχο κωδικού σε http).');
  if (h !== acc.passHash) throw new Error('invalid credentials');
  const sess = { email: acc.email };
  try { localStorage.setItem(LKEY, JSON.stringify(sess)); } catch { /* storage blocked */ }
  return sess;
}

/* Ρόλος από το JWT (cloud mode): {role, clinicId, clinicName}. Ομάδα = role null. */
export function sessionRole() {
  if (CONFIG.backend !== 'supabase') return { role: null };
  const s = sbSession();
  if (!s || !s.access_token) return { role: null };
  try {
    let b64 = s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    const am = payload.app_metadata || {};
    return { role: am.role || null, clinicId: am.clinic_id || null, clinicName: am.clinic_name || '' };
  } catch { return { role: null }; }
}

export function logout() {
  if (CONFIG.backend === 'supabase') sbSignOut();
  try { localStorage.removeItem(LKEY); } catch { /* storage blocked */ }
}
