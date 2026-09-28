// login/login.js — σύνδεση: Supabase Auth σε cloud mode, τοπικοί λογαριασμοί αλλιώς.
import { currentSession, login, sessionRole } from '/app/shared/auth.js';

if (currentSession()) location.href = sessionRole().role === 'client' ? '/client-portal/' : '/portal/';

const form = document.getElementById('loginForm');
const err = document.getElementById('err');
const btn = document.getElementById('btnLogin');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  btn.disabled = true; btn.textContent = 'Σύνδεση…';
  try {
    await login(document.getElementById('email').value, document.getElementById('password').value);
    location.href = sessionRole().role === 'client' ? '/client-portal/' : '/portal/';
  } catch (ex) {
    err.textContent = /invalid/i.test(ex.message) ? 'Λάθος email ή κωδικός.' : 'Η σύνδεση απέτυχε: ' + ex.message;
    err.hidden = false;
    btn.disabled = false; btn.textContent = 'Είσοδος';
  }
});
