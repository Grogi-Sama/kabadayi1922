// Service worker: bildirimleri gösterir, dokununca oyunu açar.
// Önbellek tutmaz (her açılışta en güncel sürüm gelsin; eski sürüm sorunlarını yaşamayalım).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Kabadayı', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || undefined, data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find(c => c.url.includes('/www/'));
    if (open) return open.focus();
    return self.clients.openWindow(e.notification.data?.url || './');
  })());
});
