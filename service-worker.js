/* Alveary Planning App — Service Worker
   If you update this file, bump SW_VERSION to force a clean update.
*/
const SW_VERSION = "v1.0.1";
const STATIC_CACHE = `alveary-static-${SW_VERSION}`;

// Keep this list SMALL.
const APP_SHELL = [
  "/",
  "/index.html",
  "/books.html",
  "/manifest.webmanifest",

  // icons (adjust folder name to match your repo)
  "/img/icons/icon-192.png",
  "/img/icons/icon-512.png",
  "/img/icons/icon-192-maskable.png",
  "/img/icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith("alveary-") && k !== STATIC_CACHE)
        .map(k => caches.delete(k))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
