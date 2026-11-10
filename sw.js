'use strict';
const CACHE_PREFIX = `vendor-card-manager-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE_VERSION = `${CACHE_PREFIX}v1.4.0-r2`;
const APP_SHELL = ['./', './index.html', './styles.css', './ui.js', './app.js', './capture.js', './ocr-parser.js', './image-tools.js', './data-core.js', './storage.js', './drive-store.js', './manifest.webmanifest', './version.json', './icon.svg', './icon-192.png', './icon-512.png'];
const SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION).map((key) => caches.delete(key)))), self.clients.claim()]));
});
let preparing = null;
self.addEventListener('message', (event) => {
  if(event.data?.type==='PREPARE_UPDATE' && !preparing){
    preparing={requestId:'starting',pending:new Set()};
    event.waitUntil((async()=>{
      const clients=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(self.registration.scope));
      if(!clients.length){preparing=null;await self.skipWaiting();return;}
      const requestId=String(Date.now());
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{
          for(const c of clients)c.postMessage({type:'UPDATE_CANCELLED',requestId});
          preparing=null;resolve();
        },30000);
        preparing={requestId,pending:new Set(clients.map(c=>c.id)),complete:async()=>{clearTimeout(timer);preparing=null;await self.skipWaiting();resolve();}};
        for(const c of clients)c.postMessage({type:'PREPARE_UPDATE',requestId});
      });
    })());
  }else if(event.data?.type==='UPDATE_READY' && preparing?.requestId===event.data.requestId){
    preparing.pending.delete(event.source?.id);
    if(!preparing.pending.size)event.waitUntil(preparing.complete());
  }
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache OAuth or authenticated Drive responses, even when HTTP headers permit caching.
  if (url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' })); return;
  }
  if (request.mode === 'navigate') {
    // Keep this version's HTML and scripts together until the next worker is ready.
    if (SHELL_URLS.has(url.href)) event.respondWith(caches.open(CACHE_VERSION).then(async (cache) => (await cache.match('./index.html')) || fetch(request)));
    return;
  }
  if (!SHELL_URLS.has(url.href)) return;
  event.respondWith(caches.open(CACHE_VERSION).then(async (cache) => (await cache.match(request)) || fetch(request)));
});
