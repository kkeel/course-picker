const SW_VERSION = "v1.0.3"; // bump every time you change JS/HTML
const CACHE_NAME = `alveary-planning-${SW_VERSION}`;

// Keep this small. Do NOT aggressively cache HTML/JS while iterating.
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
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

// Network-first for HTML/JS/CSS so exports + page code never go stale.
// Cache-first for everything else (images/icons/etc).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === location.origin;

  // Only handle same-origin; let everything else pass through.
  if (!isSameOrigin) return;

  const path = url.pathname;
  const isHTML = path.endsWith(".html") || path === "/" || path.endsWith("/index.html");
  const isJS   = path.endsWith(".js");
  const isCSS  = path.endsWith(".css");

  const networkFirst = async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  };

  const cacheFirst = async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
    }
    return res;
  };

  event.respondWith((isHTML || isJS || isCSS) ? networkFirst() : cacheFirst());
});
