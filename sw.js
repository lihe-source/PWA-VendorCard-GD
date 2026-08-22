'use strict';
const CACHE_VERSION = 'vendor-card-manager-v1.0.0';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './version.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match('./version.json'))); return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => { const copy = response.clone(); caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy)); return response; }).catch(() => caches.match('./index.html'))); return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { if (response.ok || response.type === 'opaque') { const copy = response.clone(); caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)); } return response; })));
});
