const CACHE = "kesher-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/pose.js",
  "./js/excuse.js",
  "./js/gps.js",
  "./js/board.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./fonts/rubik-hebrew-500-normal.woff2",
  "./fonts/rubik-hebrew-700-normal.woff2",
  "./fonts/rubik-hebrew-800-normal.woff2",
  "./fonts/rubik-latin-500-normal.woff2",
  "./fonts/rubik-latin-700-normal.woff2",
  "./fonts/rubik-latin-800-normal.woff2",
  "./fonts/assistant-hebrew-400-normal.woff2",
  "./fonts/assistant-hebrew-600-normal.woff2",
  "./fonts/assistant-latin-400-normal.woff2",
  "./fonts/assistant-latin-600-normal.woff2",
];

// Heavy, version-independent assets (ML runtime + model). These never change
// between app releases, so they're safe to cache-first and keep offline
// permanently instead of re-fetching on every deploy.
const HEAVY_CACHE = "kesher-heavy-v1";
const HEAVY_ASSETS = [
  "./vendor/mediapipe/vision_bundle.mjs",
  "./vendor/mediapipe/wasm/vision_wasm_internal.js",
  "./vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "./models/pose_landmarker_lite.task",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE).then((c) => c.addAll(ASSETS)),
      caches.open(HEAVY_CACHE).then((c) => c.addAll(HEAVY_ASSETS)),
    ])
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE && k !== HEAVY_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;

  const isHeavy = HEAVY_ASSETS.some((a) => url.endsWith(a.replace("./", "/")));
  if (isHeavy) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // App shell: network-first, so a new deploy is visible immediately when
  // online. Falls back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
