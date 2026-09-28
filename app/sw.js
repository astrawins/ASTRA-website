// sw.js — Astra HQ service worker: network-first με cache fallback (ώστε το app
// να ανοίγει και με κακό δίκτυο), χωρίς να κρατάει ποτέ μπαγιάτικο HTML/JS όταν υπάρχει σύνδεση.
const CACHE = 'astra-hq-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API κλήσεις (Supabase κ.λπ.) περνάνε ανέγγιχτες
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
