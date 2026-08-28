/**
 * Hand-written service worker (vite-plugin-pwa injectManifest supplies only
 * the precache list — no workbox at runtime).
 *
 * Caching strategy:
 *  - app shell (built assets):   precached on install, cache-first
 *  - /api/*:                     network only (sync must never be stale)
 *  - data/*.json:                network-first, cache fallback (programme
 *                                updates arrive when online; old copy offline)
 *  - data/images/*:              cache-first, populated on demand (and in
 *                                bulk by the "download for offline" button)
 *  - navigations:                network-first, fallback to cached shell
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

// vite-plugin-pwa replaces the literal `self.__WB_MANIFEST` token at build time.
const manifest =
  (self as unknown as { __WB_MANIFEST?: { url: string; revision: string | null }[] }).__WB_MANIFEST ?? [];
const version = manifest.map((e) => e.revision ?? e.url).join("|");
let hash = 0;
for (let i = 0; i < version.length; i++) hash = (Math.imul(hash, 31) + version.charCodeAt(i)) | 0;
const SHELL_CACHE = `shell-${(hash >>> 0).toString(36)}`;
const DATA_CACHE = "data-v1";
const IMAGE_CACHE = "images-v1";

const DATA_FILES = ["data/films.json", "data/venues.json", "data/constraints.json", "data/meta.json"];

sw.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    Promise.all([
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.addAll(manifest.map((e) => new URL(e.url, sw.location.href).href))),
      // Warm the data cache immediately — the page's own first fetch happens
      // before this worker controls it, so it would otherwise go uncached.
      caches
        .open(DATA_CACHE)
        .then((cache) => cache.addAll(DATA_FILES.map((f) => new URL(f, sw.location.href).href)))
        .catch(() => {}),
    ]).then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE && key !== IMAGE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

sw.addEventListener("fetch", (event: FetchEvent) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (url.pathname.startsWith("/api/")) return; // network only

  if (url.pathname.includes("/data/images/")) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }
  if (url.pathname.includes("/data/")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        const shell = await cache.match(new URL("index.html", sw.location.href).href);
        return shell ?? Response.error();
      }),
    );
    return;
  }
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
