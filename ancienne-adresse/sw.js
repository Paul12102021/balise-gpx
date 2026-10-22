// Ancienne adresse : remplace l'ancien service worker de l'appli. Il ne garde plus rien en cache
// (la page de déménagement vient toujours du réseau) et laisse les données de la page intactes.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('app-')) await caches.delete(k);
  await self.clients.claim();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
