// Loop phone test service worker (throwaway).
// - App shell: network-first, falls back to cache (so the page opens offline).
// - Media (/media/, /pilots/): served from Cache Storage if downloaded, with Range -> 206 slicing
//   (Safari requires 206 range responses to play <audio>/<video>). Otherwise passes to network.
const SHELL = 'tw-shell-v5';
const MEDIA = 'tw-media-v2';   // v2 (Oct 9): cymatics-01 audio v2 (air layer removed) -- drop stale downloaded audio
const SHELL_FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './manifest-minimal.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './sessions.json', './keepalive_10s.m4a', './TEST_SCRIPT.md'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('tw-shell-') && k !== SHELL) await caches.delete(k);
      if (k.startsWith('tw-media-') && k !== MEDIA) await caches.delete(k);   // stale offline media
    }
    await self.clients.claim();
  })());
});

function isMedia(url) { return url.pathname.includes('/media/') || url.pathname.includes('/pilots/'); }

async function rangeResponse(cached, rangeHeader) {
  const blob = await cached.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  if (!m) return new Response(blob, { status: 200, headers: cached.headers });
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const slice = blob.slice(start, end + 1);
  return new Response(slice, {
    status: 206, statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': String(slice.size),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'X-From-SW-Cache': '1',
    },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isMedia(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const cached = await cache.match(url.pathname, { ignoreSearch: true, ignoreVary: true });
      if (cached) {
        const r = req.headers.get('range');
        if (r) return rangeResponse(cached, r);
        return cached;
      }
      return fetch(req);
    })());
    return;
  }

  // shell: network-first, cache fallback
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && (url.pathname.endsWith('/') || /\.(html|js|webmanifest|png|json|md|m4a)$/.test(url.pathname))) {
        const c = await caches.open(SHELL); c.put(url.pathname, res.clone());
      }
      return res;
    } catch (err) {
      const c = await caches.open(SHELL);
      return (await c.match(url.pathname, { ignoreSearch: true })) ||
             (req.mode === 'navigate' ? c.match('./index.html') : Response.error());
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'ping') e.source && e.source.postMessage({ pong: true, shell: SHELL, media: MEDIA });
});
