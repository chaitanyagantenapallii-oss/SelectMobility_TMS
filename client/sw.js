/*
 * Service worker for the field and client apps.
 *
 * The constraint that shapes every decision here: a driver's phone is on a
 * patchy connection at a pickup point at 06:45. The app must open, and the
 * last manifest it saw must still be readable, even with no signal at all.
 *
 * So the rule is simple and deliberately narrow:
 *   - App shell (HTML, CSS, JS, icons) is cached and served from cache first.
 *     These change only when we ship, so the cache is cheap to keep correct.
 *   - API calls are never cached. A stale manifest is worse than an honest
 *     "we can't reach the office right now" - a driver who boards someone
 *     against yesterday's list has made a real-world mistake.
 *
 * The exception is a small last-seen snapshot, written by the app pages
 * themselves rather than by the worker. That keeps the cache key and the
 * shape of the data owned by the code that understands them.
 */

const VERSION = 'v1';
const SHELL_CACHE = `smi-shell-${VERSION}`;

const SHELL_ASSETS = [
  '/driver.html',
  '/client.html',
  '/css/app.css',
  '/css/mobile.css',
  '/js/api.js',
  '/js/mobile.js',
  '/manifest-driver.webmanifest',
  '/manifest-client.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // addAll is all-or-nothing: one 404 and the whole install fails, which
      // would leave the app unusable. Add them individually so a single
      // missing icon cannot take down offline support.
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            /* An asset we could not cache is not worth failing install over. */
          })
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('smi-shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with anything that is not a plain GET. Boarding, fuel and
  // breakdown posts must reach the server or fail loudly.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only. Cross-origin requests are left alone entirely.
  if (url.origin !== self.location.origin) return;

  // API traffic always goes to the network. See the note at the top: an out
  // of date passenger list is a safety problem, not a convenience trade-off.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: try the network so a deployed update is picked up promptly,
  // but fall back to the cached shell when the phone is offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (err) {
          const cache = await caches.open(SHELL_CACHE);
          const path = url.pathname === '/' ? '/index.html' : url.pathname;
          const cached = (await cache.match(path)) || (await cache.match(request));
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Static assets: cache first, because by definition they only change when we
  // ship a new version and the cache name changes with it.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Only cache clean same-origin responses. Opaque or error responses
        // would poison the cache with something we can never inspect.
        if (response && response.ok && response.type === 'basic') {
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});
