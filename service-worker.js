const SW_VERSION = "v1.0.1";
const CACHE_NAME = `alveary-planning-${SW_VERSION}`;

// Minimal shell — avoid hard-caching lots of files while you're actively changing things.
const APP_SHELL = [
  "/",
  "/index.html",
  "/books.html",
  "/manifest.webmanifest",
  "/img/icons/icon-192.png",
  "/img/icons/icon-512.png",
  "/img/icons/icon-192-maskable.png",
  "/img/icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {}) // don't fail install if any single asset 404s
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GET requests
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        // Cache same-origin successful responses
        try {
          const url = new URL(req.url);
          if (url.origin === location.origin && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
        } catch (_) {}
        return res;
      });
    })
  );
});
