/* Alveary Yearly Planning App — Service Worker
   If you update this file later, bump SW_VERSION to force an update.
*/
const SW_VERSION = "v1.0.0";
const STATIC_CACHE = `alveary-static-${SW_VERSION}`;

// Keep this list SMALL while you're still building pages.
const APP_SHELL = [
  "/index.html",
  "/books.html",
  "/manifest.webmanifest",

  // Icons (confirmed working path)
  "/img/icons/icon-192.png",
  "/img/icons/icon-512.png",
  "/img/icons/icon-192-maskable.png",
  "/img/icons/icon-512-maskable.png",
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
        .filter(k => k.startsWith("alveary-static-") && k !== STATIC_CACHE)
        .map(k => caches.delete(k))
    );
    self.clients.claim();
  })());
});

// Fetch strategy:
// - HTML: network-first (avoids stale pages during development)
// - Other same-origin GET: cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isHTML = accept.includes("text/html");

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
