const CACHE_NAME = 'nutrienttrack-shell-v12'
// The label reader's engine and model (served from ocr/, fetched on first use) live in a cache of their own. It is named
// for the tesseract.js-core version and the language model, so an app update that bumps CACHE_NAME keeps the ~5 MB of OCR
// files, and a new engine or model starts a fresh cache and drops the old one. Bump it with those packages (src/sw.test.ts checks).
const OCR_CACHE_PREFIX = 'nutrienttrack-ocr-'
const OCR_CACHE = 'nutrienttrack-ocr-core7.0.0-eng-4.0.0_best_int'
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/nutrienttrack-192.png',
  './icons/nutrienttrack-512.png',
  './fonts/ibm-plex-sans-latin.woff2',
  './fonts/ibm-plex-sans-latin-ext.woff2',
]

// The 2 MB catalog and its 1 MB nutrient table are not part of install: they are fetched on first use or warmed after activation (invariant 7: keep the file names in step with src/catalog).
const CATALOG = ['./data/usda-common-v2.json', './data/usda-nutrients-v1.json']

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

// Vite build files carry a content hash in their name, so a cached copy never goes stale.
const isHashedAsset = (url) => new URL(url).pathname.startsWith(new URL('./assets/', scopeUrl()).pathname)

const cachePageAndAssets = async (cache, response) => {
  const html = await response.clone().text()
  const assetUrls = pageAssetUrls(html)
  const cached = await Promise.all(assetUrls.map((url) => (isHashedAsset(url) ? cache.match(url) : undefined)))
  const missingUrls = assetUrls.filter((_, index) => !cached[index])
  // Hashed files never change, so the browser's own cache may answer; other files revalidate. Only the page itself is fetched with no-store.
  const assetResponses = await Promise.all(missingUrls.map((url) => (isHashedAsset(url) ? fetch(url) : fetch(url, { cache: 'no-cache' }))))
  if (assetResponses.some((assetResponse) => !assetResponse.ok)) throw new Error('A page asset could not be cached.')

  const indexUrl = absoluteUrl('./index.html')
  await cache.put(indexUrl, response.clone())
  await cache.put(absoluteUrl('./'), response.clone())
  await Promise.all(missingUrls.map((url, index) => cache.put(url, assetResponses[index].clone())))
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

// Carry the catalog over from an older cache when its file name is unchanged, so an update does not download it again.
const carryCatalog = async (previousKeys) => {
  const cache = await caches.open(CACHE_NAME)
  for (const path of CATALOG) {
    const url = absoluteUrl(path)
    if (await cache.match(url)) continue
    for (const key of previousKeys) {
      const response = await (await caches.open(key)).match(url)
      if (response) {
        await cache.put(url, response.clone())
        break
      }
    }
  }
}

// Fill the catalog and its nutrient table in the background so offline search and nutrients work once warmed.
const warmCatalog = async () => {
  const cache = await caches.open(CACHE_NAME)
  for (const path of CATALOG) {
    const url = absoluteUrl(path)
    if (await cache.match(url)) continue
    // One failed download must not stop the next file from warming.
    try {
      const response = await fetch(url)
      if (response.ok) await cache.put(url, response.clone())
    } catch {
      // Fetched again on first use.
    }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        // Other versions of the shell go; the current OCR cache stays, older OCR caches go.
        const previous = keys.filter((key) => key !== CACHE_NAME && !key.startsWith(OCR_CACHE_PREFIX))
        const staleOcr = keys.filter((key) => key.startsWith(OCR_CACHE_PREFIX) && key !== OCR_CACHE)
        await carryCatalog(previous).catch(() => undefined)
        await Promise.all([...previous, ...staleOcr].map((key) => caches.delete(key)))
      })
      .then(() => self.clients.claim())
      .then(() => {
        // Not awaited: activation must not wait on the catalog download.
        warmCatalog().catch(() => undefined)
      }),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  // The static food pages, the recipe calculator and the sitemap are their own documents: never cache them as the app shell.
  const path = new URL(event.request.url).pathname
  const scopePath = scopeUrl().pathname
  if (path.startsWith(`${scopePath}foods/`) || path.startsWith(`${scopePath}recipe-calories/`) || path === `${scopePath}sitemap.xml` || path === `${scopePath}robots.txt`) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Show the page now; refresh the offline copy in the background.
          if (response.ok) {
            const copy = response.clone()
            event.waitUntil(
              caches.open(CACHE_NAME)
                .then((cache) => cachePageAndAssets(cache, copy))
                .catch(() => {
                  // Keep the last known-good HTML and matching assets when an update is incomplete.
                }),
            )
          }
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(absoluteUrl('./index.html')))),
    )
    return
  }

  // The OCR engine: cache first from its own versioned cache, filled the first time the scanner is used.
  if (path.startsWith(`${scopePath}ocr/`)) {
    event.respondWith(
      caches.open(OCR_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request.url, { ignoreVary: true })
        if (cached) return cached
        try {
          const response = await fetch(event.request)
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone()
            event.waitUntil(cache.put(event.request.url, copy).catch(() => undefined))
          }
          return response
        } catch {
          return new Response('', { status: 503, statusText: 'Offline' })
        }
      }),
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
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request.url, copy)).catch(() => undefined))
          }
          return response
        })
        .catch(() => {
          return new Response('', { status: 503, statusText: 'Offline' })
        })
    }),
  )
})
