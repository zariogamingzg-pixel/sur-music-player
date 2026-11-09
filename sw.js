const CACHE = "sur-shell-v4";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.png",
];
const shellURLs = new Set(
  SHELL.map((path) => new URL(path, self.registration.scope).href),
);

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
        try { await cache.put(cacheURL.href, response.clone()); } catch {}
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
