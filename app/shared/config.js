// shared/config.js — runtime configuration. Μόνο PUBLIC τιμές εδώ (το publishable key είναι ασφαλές για browsers).
// Άδειες τιμές → η εφαρμογή τρέχει σε τοπικό mode (localStorage, δεδομένα ανά browser).
// Συμπλήρωσε URL + key από το Supabase project (Settings → API) → κοινή βάση για όλη την ομάδα + login.
const SUPABASE_URL = 'https://uqddmzyoqaxdoycdpvth.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TWbnaQTtHtfhsQOeHqrqGw_yFjjNqSs';

export const CONFIG = Object.freeze({
  backend: SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? 'supabase' : 'local',
  supabaseUrl: SUPABASE_URL,
  supabaseKey: SUPABASE_PUBLISHABLE_KEY,
  timezone: 'Europe/Athens',
});

export const isLocal = () => CONFIG.backend === 'local';

/* Λογαριασμοί για το τοπικό mode (μόνο για development χωρίς Supabase).
 * Σε supabase mode το login γίνεται από το Supabase Auth και αυτή η λίστα αγνοείται.
 * Μορφή: { email, passHash } με SHA-256 hash του κωδικού:
 * node -e "console.log(require('crypto').createHash('sha256').update('ΚΩΔΙΚΟΣ').digest('hex'))" */
export const LOCAL_ACCOUNTS = [];
