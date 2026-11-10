const CACHE = "sur-shell-v11";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./src/app.js",
  "./src/core/app-state.js",
  "./src/utils/format.js",
  "./src/services/database.js",
  "./src/services/audio.js",
  "./src/services/library.js",
  "./src/services/media-session.js",
  "./src/services/offline.js",
  "./src/ui/library.js",
  "./src/ui/player.js",
  "./src/ui/notifications.js",
  "./manifest.webmanifest",
  "./music-icon.png",
  "./apple-touch-icon.png",
];
const shellURLs = new Set(
  SHELL.map((path) => new URL(path, self.registration.scope).href),
);

// Keep one authoritative shell list. The page asks the installed worker to
// verify it rather than duplicating cache versions and asset paths in app code.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "SUR_VERIFY_OFFLINE" || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const complete = (await Promise.all([...shellURLs].map((url) => cache.match(url)))).every(Boolean);
      event.ports[0].postMessage({ complete });
    } catch {
      event.ports[0].postMessage({ complete: false });
    }
  })());
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(
        SHELL.map((path) => new Request(
          new URL(path, self.registration.scope), { cache: "reload" },
        )),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("sur-shell-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const cacheURL = new URL(url);
  cacheURL.search = "";
  if (!shellURLs.has(cacheURL.href) && request.mode !== "navigate") return;

  // Show saved edits immediately online; retain the last good copy offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let response;
    try {
      response = await fetch(request, { cache: "no-store" });
      if (response.ok && shellURLs.has(cacheURL.href)) {
        try { await cache.put(cacheURL.href, response.clone()); } catch (error) {
          // Cache refresh is best-effort when storage is full. A valid online
          // response must still reach the player.
          console.warn("Sur could not refresh an offline asset", error);
        }
      }
      if (response.ok) return response;
    } catch {
      // Network failures and HTTP failures both use the saved app shell.
    }
    const cached = await cache.match(cacheURL.href);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const page = await cache.match(new URL("./index.html", self.registration.scope).href);
      if (page) return page;
    }
    if (response) return response;
    throw new Error("Offline resource unavailable");
  })());
});
