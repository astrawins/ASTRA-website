// shared/gcal.js — Google Calendar: ανάγνωση με API key (δημόσιο ημερολόγιο),
// εγγραφές με OAuth token μέσω Google Identity Services (φορτώνεται στο index.html).
// Οι αλλαγές γίνονται απευθείας στο πραγματικό ημερολόγιο — καμία τοπική αντιγραφή.

import { callFunction } from './supabase.js';

export const DEFAULT_CAL_ID = 'c_94979b06394b99c6b2af7a54165ebfb8511bf42bbdcde07247af23cea3cccdd8@group.calendar.google.com';
const API = 'https://www.googleapis.com/calendar/v3/calendars/';
const TZ = 'Europe/Athens';

/* Access token: μοιράζεται από τον server (gcal-auth function) που κρατά μόνιμο
   refresh token — η ομάδα συνδέεται με Google ΜΙΑ φορά συνολικά. */
let accessToken = null, tokenExp = 0;
try {
  const s = JSON.parse(localStorage.getItem('astra_gtok') || 'null');
  if (s && s.exp > Date.now()) { accessToken = s.t; tokenExp = s.exp; }
} catch { /* storage blocked */ }
function saveTok(t, expiresIn) {
  accessToken = t; tokenExp = Date.now() + ((expiresIn || 3600) - 90) * 1000;
  try { localStorage.setItem('astra_gtok', JSON.stringify({ t, exp: tokenExp })); } catch { /* ok */ }
}
function dropTok() { accessToken = null; tokenExp = 0; try { localStorage.removeItem('astra_gtok'); } catch { /* ok */ } }

export const gisReady = () => typeof google !== 'undefined' && !!(google.accounts && google.accounts.oauth2);
export const hasToken = () => !!accessToken && Date.now() < tokenExp;

/* Αθόρυβο token από τον server. code 'connect_needed' αν δεν έχει γίνει ποτέ η σύνδεση. */
export async function getToken(clientId) {
  if (hasToken()) return accessToken;
  try {
    const j = await callFunction('gcal-auth', { action: 'token', clientId });
    saveTok(j.access_token, j.expires_in);
    return accessToken;
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('not_connected')) { const err = new Error('Θέλει μία (πρώτη) σύνδεση Google.'); err.code = 'connect_needed'; throw err; }
    if (msg.includes('missing_secret')) { const err = new Error('Λείπει το Google client secret στον server (supabase secrets).'); err.code = 'missing_secret'; throw err; }
    throw e;
  }
}

/* Η μία-και-μοναδική σύνδεση: popup → auth code → ο server κρατά refresh token για πάντα. */
export function connectPermanent(clientId) {
  return new Promise((resolve, reject) => {
    if (!clientId) return reject(new Error('Δεν έχει οριστεί OAuth Client ID στις Ρυθμίσεις.'));
    if (!gisReady()) return reject(new Error('Το Google script δεν φόρτωσε — ανανέωσε τη σελίδα.'));
    const c = google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      // Όλα όσα μπορεί να χρειαστεί ποτέ το Astra HQ — μία συγκατάθεση, μία φορά:
      // ημερολόγιο (πλήρες), Sheets (λογιστής + ιδιωτικά lead sheets), Gmail send
      // (μελλοντικές αναφορές σε πελάτες), Drive file (αρχεία που φτιάχνει το app).
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/drive.file',
      ].join(' '),
      ux_mode: 'popup',
      callback: async (resp) => {
        if (resp.error) return reject(new Error('Η σύνδεση απέτυχε: ' + resp.error));
        try {
          const j = await callFunction('gcal-auth', { action: 'save', code: resp.code, clientId });
          saveTok(j.access_token, j.expires_in);
          resolve(accessToken);
        } catch (e) { reject(e); }
      },
    });
    c.requestCode();
  });
}

/* Για εγγραφές (καλείται από click): αθόρυβο token, αλλιώς ανοίγει τη μία-φορά σύνδεση. */
export async function ensureToken(clientId) {
  try { return await getToken(clientId); }
  catch (e) { if (e.code === 'connect_needed') return connectPermanent(clientId); throw e; }
}

function evOut(e) {
  const allDay = !!(e.start && e.start.date);
  const startRaw = e.start ? (e.start.dateTime || e.start.date) : '';
  const endRaw = e.end ? (e.end.dateTime || e.end.date) : '';
  return {
    id: e.id, title: e.summary || '(χωρίς τίτλο)', desc: e.description || '',
    allDay,
    date: String(startRaw).slice(0, 10),
    start: allDay ? '' : String(startRaw).slice(11, 16),
    end: allDay ? '' : String(endRaw).slice(11, 16),
    link: e.htmlLink || '',
    meet: e.hangoutLink || '',
    attendees: (e.attendees || []).filter((a) => !a.organizer && !a.resource).map((a) => a.email),
  };
}

/* Συμβάντα του μήνα. Με OAuth token (ιδιωτικό ημερολόγιο) όταν υπάρχει clientId,
   αλλιώς με API key (μόνο για δημόσια ημερολόγια). */
export async function listEvents({ apiKey, clientId }, calId, monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const timeMin = new Date(Date.UTC(y, m - 1, 1) - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.UTC(y, m, 1) + 24 * 3600 * 1000).toISOString();
  let url = `${API}${encodeURIComponent(calId)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=250`;
  const headers = {};
  if (clientId) { const t = await getToken(clientId); headers.Authorization = 'Bearer ' + t; }
  else if (apiKey) url += `&key=${encodeURIComponent(apiKey)}`;
  else throw new Error('Χρειάζεται σύνδεση Google για το ιδιωτικό ημερολόγιο.');
  const r = await fetch(url, { headers });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { dropTok(); throw new Error('Έληξε η σύνδεση Google — ξαναδοκίμασε.'); }
  if (r.status === 404) { const err = new Error('Δεν υπάρχει πρόσβαση στο ημερολόγιο.'); err.code = 'connect_needed'; throw err; }
  if (!r.ok) throw new Error(j.error && j.error.message ? 'Google Calendar: ' + j.error.message : 'Σφάλμα ανάγνωσης ημερολογίου.');
  return (j.items || []).filter((e) => e.status !== 'cancelled').map(evOut);
}

function buildBody({ title, desc, date, start, end, attendees, meet }, isPatch) {
  const body = { summary: title, description: desc || '' };
  if (Array.isArray(attendees)) body.attendees = attendees.map((email) => ({ email }));
  if (meet === true) {
    body.conferenceData = { createRequest: { requestId: 'astra-' + Date.now().toString(36), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  } else if (meet === false && isPatch) {
    body.conferenceData = null; // αφαίρεση υπάρχοντος Meet
  }
  if (start) {
    body.start = { dateTime: `${date}T${start}:00`, timeZone: TZ };
    body.end = { dateTime: `${date}T${end || start}:00`, timeZone: TZ };
    if ((end || start) <= start) body.end.dateTime = `${date}T${start}:00`;
  } else {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    body.start = { date };
    body.end = { date: d.toISOString().slice(0, 10) }; // exclusive
  }
  return body;
}

async function authed(clientId, method, path, body) {
  const token = await ensureToken(clientId);
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { dropTok(); throw new Error('Έληξε η σύνδεση Google — ξαναπροσπάθησε.'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error && j.error.message ? 'Google: ' + j.error.message : 'Σφάλμα Google Calendar (' + r.status + ')'); }
  return r.status === 204 ? null : r.json();
}

/* conferenceDataVersion=1 → δημιουργία Meet· sendUpdates=all → οι καλεσμένοι λαμβάνουν email πρόσκλησης/ακύρωσης. */
const Q = '?conferenceDataVersion=1&sendUpdates=all';
export const createEvent = (clientId, calId, ev) => authed(clientId, 'POST', `${encodeURIComponent(calId)}/events${Q}`, buildBody(ev, false));
export const patchEvent = (clientId, calId, id, ev) => authed(clientId, 'PATCH', `${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}${Q}`, buildBody(ev, true));
export const deleteEvent = (clientId, calId, id) => authed(clientId, 'DELETE', `${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}?sendUpdates=all`);
