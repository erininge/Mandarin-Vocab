/*
  Kat’s Mandarin Garden 🌸 — HSK 1
  Changelog:
  - V6.8: add tone recognition lessons + listening mode + cache refresh
  - V6.7: add app refresh/update control + force cache refresh flow
  - V6.6: add Lesson 11 vocab + cache update
  - V6.4: add Adjectives lesson + cache update
  - V6.3: add Lesson 9 vocab + cache update
*/
const CACHE_NAME = "hsk1-mandarin-garden-cache-v1.1";
const CORE_ASSETS = [
  "./",
  "./index.html?f=v1.1",
  "./styles.css?f=v1.1",
  "./app.js?f=v1.1",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/Sakura.mp4",
  "./lessons/index.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (!event.data?.type) return;
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data.type === "CLEAR_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isLesson = url.pathname.includes("/lessons/") && url.pathname.endsWith(".json");
  const isAudio = url.pathname.includes("/audio/") && /\.(wav|mp3|m4a|ogg)$/.test(url.pathname);

  if (isLesson || isAudio) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
