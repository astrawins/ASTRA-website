// sw.js (root) — ελέγχει ΟΛΟ το site (scope /) ώστε το app (/portal, /login, /client-portal, /app) να
// παίρνει πάντα φρέσκο HTML/JS/CSS: network-first με επανεπικύρωση (cache: 'no-cache' → το ETag
// του host απαντά 304 σε δευτερόλεπτα), και cache fallback μόνο όταν δεν υπάρχει δίκτυο.
// Είναι ο ΜΟΝΑΔΙΚΟΣ worker του scope '/' και χειρίζεται και τα push (οι συσκευές είναι γραμμένες σε αυτό το scope).
const CACHE = 'astra-site-v2';
const APP = /^\/(portal|client-portal|login|app)(\/|$)/;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !APP.test(url.pathname)) return; // API/Supabase & marketing site ανέγγιχτα
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(e.request)),
  );
});

/* ---- push ειδοποιήσεις: εμφανίζονται και με το app κλειστό ---- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Astra HQ', {
    body: d.body || '', tag: d.tag || undefined, data: { url: d.url || '/portal/' },
    icon: '/app/assets/icon-192.png', badge: '/app/assets/icon-192.png',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/portal/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith('/portal'));
    if (open) return open.focus().then(() => open.navigate(url).catch(() => {}));
    return self.clients.openWindow(url);
  }));
});
