const CACHE_NAME = 'nutrienttrack-shell-v6'
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/nutrienttrack-192.png',
  './icons/nutrienttrack-512.png',
  './data/usda-common-v1.json',
]

const scopeUrl = () => new URL(self.registration.scope)
const absoluteUrl = (path) => new URL(path, scopeUrl()).href

const pageAssetUrls = (html) => {
  const assets = []
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const candidate = new URL(match[1], absoluteUrl('./index.html'))
    if (candidate.origin === scopeUrl().origin) assets.push(candidate.href)
  }
  return [...new Set(assets)]
}

const cachePageAndAssets = async (cache, response) => {
  const html = await response.clone().text()
  const assetUrls = pageAssetUrls(html)
  const assetResponses = await Promise.all(assetUrls.map((url) => fetch(url, { cache: 'no-store' })))
  if (assetResponses.some((assetResponse) => !assetResponse.ok)) throw new Error('A page asset could not be cached.')

  const indexUrl = absoluteUrl('./index.html')
  await cache.put(indexUrl, response.clone())
  await cache.put(absoluteUrl('./'), response.clone())
  await Promise.all(assetUrls.map((url, index) => cache.put(url, assetResponses[index].clone())))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const indexResponse = await fetch(absoluteUrl('./index.html'), { cache: 'no-store' })
      await cachePageAndAssets(cache, indexResponse)
      const staticAssets = APP_SHELL.filter((path) => path !== './' && path !== './index.html').map(absoluteUrl)
      await cache.addAll(staticAssets)
    }).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          try {
            await cachePageAndAssets(await caches.open(CACHE_NAME), response.clone())
          } catch {
            // Keep the last known-good HTML and matching assets when an update is incomplete.
          }
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(absoluteUrl('./index.html')))),
    )
    return
  }

  event.respondWith(
    caches.match(event.request.url, { ignoreVary: true }).then((cached) => {
      if (cached) return cached

      return fetch(event.request)
        .then((response) => {
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request.url, copy))
          }
          return response
        })
        .catch(() => {
          return new Response('', { status: 503, statusText: 'Offline' })
        })
    }),
  )
})
