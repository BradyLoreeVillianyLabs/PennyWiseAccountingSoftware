/* global caches, Request, self */

const CACHE_PREFIX = "clearledger-static-";
const SHELL_SCHEMA = "commerce-dashboard-v8";
const CACHE_NAME = `${CACHE_PREFIX}__CLEARLEDGER_CACHE_VERSION__-${SHELL_SCHEMA}`;
const STATIC_ASSETS = new Map([
  ["/offline.html", "text/html"],
  ["/app.js", "javascript"],
  ["/pwa.js", "javascript"],
  ["/money.js", "javascript"],
  ["/styles.css", "text/css"],
  ["/manifest.webmanifest", "json"],
  ["/icons/clearledger.svg", "image/svg+xml"],
  ["/icons/clearledger-maskable.svg", "image/svg+xml"]
]);
const STATIC_PATHS = new Set(STATIC_ASSETS.keys());
const SENSITIVE_PATH_PREFIXES = ["/api", "/public", "/v1", "/auth", "/oauth"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        [...STATIC_ASSETS.keys()].map(async (pathname) => {
          const request = new Request(new URL(pathname, self.location.origin), {
            cache: "reload",
            credentials: "same-origin"
          });
          const response = await fetch(request);
          if (!isCacheableStaticResponse(response, pathname)) {
            throw new Error(`Refused to cache an invalid static response for ${pathname}.`);
          }
          await cache.put(pathname, response);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API, auth, public financial documents, and every non-allowlisted path bypass Cache API.
  if (isSensitivePath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (!STATIC_PATHS.has(url.pathname)) return;
  event.respondWith(staticResponse(request, url.pathname));
});

function isSensitivePath(pathname) {
  return SENSITIVE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

async function navigationResponse(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    return (await caches.match("/offline.html")) ?? Response.error();
  }
}

async function staticResponse(request, pathname) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (isCacheableStaticResponse(response, pathname)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(pathname, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(pathname);
    if (cached) return cached;
    throw error;
  }
}

function isCacheableStaticResponse(response, pathname) {
  if (!response.ok || response.redirected || response.type !== "basic") return false;

  const responseUrl = new URL(response.url);
  if (responseUrl.origin !== self.location.origin || responseUrl.pathname !== pathname)
    return false;

  const expectedContentType = STATIC_ASSETS.get(pathname);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return Boolean(expectedContentType && contentType.includes(expectedContentType));
}
