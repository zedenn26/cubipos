/* Cache only public CubiPOS brand assets. Never cache pages, Auth, API or Supabase responses. */
const brandAssets = ['/icon-192.png', '/cubipos-logo.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open('cubipos-static-v2').then(cache => cache.addAll(brandAssets))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => { const url = new URL(event.request.url); if (event.request.method === 'GET' && url.origin === self.location.origin && brandAssets.includes(url.pathname)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))); });
