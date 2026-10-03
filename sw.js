// sw.js (root) — ελέγχει ΟΛΟ το site (scope /) ώστε το app (/portal, /login, /client-portal, /app) να
// παίρνει πάντα φρέσκο HTML/JS/CSS: network-first με επανεπικύρωση (cache: 'no-cache' → το ETag
// του host απαντά 304 σε δευτερόλεπτα), και cache fallback μόνο όταν δεν υπάρχει δίκτυο.
// Οι push ειδοποιήσεις μένουν στο /app/sw.js (εκεί είναι γραμμένες οι συσκευές).
const CACHE = 'astra-site-v1';
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
