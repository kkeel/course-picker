/* Alveary Yearly Planning App — Service Worker (INACTIVE until registered)
   If you ever update this file later, bump SW_VERSION to force an update.
*/
const SW_VERSION = "v1.0.0";
const STATIC_CACHE = `alveary-static-${SW_VERSION}`;

// Keep this list SMALL while you're still building pages.
const APP_SHELL = [
  "/course-picker/",
  "/course-picker/index.html",
  "/course-picker/manifest.webmanifest",

  // App icons (your folder)
  "/course-picker/img/icon/icon-192.png",
  "/course-picker/img/icon/icon-512.png",
  "/course-picker/img/icon/icon-192-maskable.png",
  "/course-picker/img/icon/icon-512-maskable.png"
];

// Install: cache the shell
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

// Activate: remove older caches
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

// Fetch: cache-first for same-origin GET requests
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
