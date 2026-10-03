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
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
