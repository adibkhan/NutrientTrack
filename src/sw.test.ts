import { describe, expect, it } from 'vitest'
import swSource from '../public/sw.js?raw'

const SCOPE = 'https://app.test/'
const CACHE_NAME = 'nutrienttrack-shell-v12'
const JS = `${SCOPE}assets/index-abc123.js`
const CSS = `${SCOPE}assets/index-abc123.css`
const MANIFEST = `${SCOPE}manifest.webmanifest`
const ICON = `${SCOPE}icons/nutrienttrack-192.png`
const INDEX = `${SCOPE}index.html`

const pageHtml = (tag: string) =>
  `<!doctype html><!-- ${tag} --><link href="./assets/index-abc123.css"><link href="./manifest.webmanifest">` +
  `<link href="./icons/nutrienttrack-192.png"><script src="./assets/index-abc123.js"></script>`

type Keyed = string | { url: string }
type FakeEvent = {
  request: { method: string; mode: string; url: string }
  respondWith: (p: Promise<Response>) => void
  waitUntil: (p: Promise<unknown>) => void
}
type Handler = (event: FakeEvent) => void
type Responder = (url: string) => Promise<Response>
type Worker = ReturnType<typeof loadWorker>

const ok = (body = 'x') => Promise.resolve(new Response(body, { status: 200 }))
const never = () => new Promise<Response>(() => {})

const loadWorker = (source: string = swSource, otherCaches: string[] = []) => {
  // Named caches, as in a browser. `store` is the app shell cache; every other name is a separate store.
  const stores = new Map<string, Map<string, Response>>([[CACHE_NAME, new Map()], ...otherCaches.map((name) => [name, new Map<string, Response>()] as const)])
  const store = stores.get(CACHE_NAME) as Map<string, Response>
  const keyOf = (r: Keyed) => (typeof r === 'string' ? r : r.url)
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const mine = stores.get(name) as Map<string, Response>
    return {
      match: async (r: Keyed) => mine.get(keyOf(r))?.clone(),
      put: async (r: Keyed, res: Response) => void mine.set(keyOf(r), res),
      addAll: async () => {},
      keys: async () => [...mine.keys()],
      delete: async (r: string) => mine.delete(r),
    }
  }
  const caches = {
    open: async (name: string) => cacheFor(name),
    match: async (r: Keyed) => cacheFor(CACHE_NAME).match(r),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  }
  const handlers: Record<string, Handler> = {}
  const self = {
    registration: { scope: SCOPE },
    location: { origin: 'https://app.test' },
    addEventListener: (type: string, h: Handler) => void (handlers[type] = h),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  const fetched: string[] = []
  const routes = new Map<string, Responder>()
  const fetchInit = new Map<string, RequestInit | undefined>()
  const fakeFetch = (input: Keyed, init?: RequestInit) => {
    const url = keyOf(input)
    fetched.push(url)
    fetchInit.set(url, init)
    return (routes.get(url) ?? (() => ok()))(url)
  }
  new Function('self', 'caches', 'fetch', 'Response', 'URL', source)(self, caches, fakeFetch, Response, URL)

  const dispatch = (url: string, mode: string, method = 'GET') => {
    let responded: Promise<Response> | undefined
    const waits: Promise<unknown>[] = []
    handlers.fetch({
      request: { method, mode, url },
      respondWith: (p) => void (responded = p),
      waitUntil: (p) => void waits.push(p),
    })
    return { responded: responded as Promise<Response>, waits }
  }
  const lifecycle = (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = []
    handlers[type]({ request: { method: 'GET', mode: 'cors', url: '' }, respondWith: () => {}, waitUntil: (p) => void waits.push(p) })
    return Promise.all(waits)
  }
  return {
    store,
    stores,
    fetched,
    fetchInit,
    lifecycle,
    dispatch,
    route: (url: string, r: Responder) => void routes.set(url, r),
  }
}

const TIMEOUT = Symbol('timeout')
const within = <T,>(p: Promise<T>, ms = 100) =>
  Promise.race([p, new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), ms))])

const seedOldPage = (w: Worker) => {
  w.store.set(INDEX, new Response(pageHtml('old')))
  w.store.set(SCOPE, new Response(pageHtml('old')))
}
const text = async (key: string, w: Worker) => w.store.get(key)?.clone().text()
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('service worker navigation', () => {
  it('returns_the_page_without_waiting_for_a_hung_asset_fetch', async () => {
    const w = loadWorker()
    w.route(SCOPE, () => ok(pageHtml('new')))
    w.route(CSS, never)
    w.route(JS, never)
    const { responded, waits } = w.dispatch(SCOPE, 'navigate')
    const result = await within(responded)
    expect(result).not.toBe(TIMEOUT)
    expect(await (result as Response).text()).toContain('new')
    expect(waits).toHaveLength(1)
    expect(await within(waits[0])).toBe(TIMEOUT)
  })

  it('caches_page_root_and_assets_in_background_after_a_200_navigation', async () => {
    const w = loadWorker()
    w.route(SCOPE, () => ok(pageHtml('new')))
    const { responded, waits } = w.dispatch(SCOPE, 'navigate')
    await responded
    await Promise.all(waits)
    expect(await text(INDEX, w)).toContain('new')
    expect(await text(SCOPE, w)).toContain('new')
    for (const url of [JS, CSS, MANIFEST, ICON]) expect(w.store.has(url)).toBe(true)
  })

  it('does_not_refetch_cached_hashed_assets_but_fetches_manifest_icons_and_uncached_hashed', async () => {
    const w = loadWorker()
    w.store.set(JS, new Response('cached-js'))
    w.route(SCOPE, () => ok(pageHtml('new')))
    const { responded, waits } = w.dispatch(SCOPE, 'navigate')
    await responded
    await Promise.all(waits)
    const assetFetches = w.fetched.filter((u) => u !== SCOPE)
    expect(assetFetches).not.toContain(JS)
    expect([...assetFetches].sort()).toEqual([CSS, ICON, MANIFEST].sort())
    expect(await text(JS, w)).toBe('cached-js')
  })

  it('keeps_previous_index_when_an_asset_returns_404_but_still_returns_new_page', async () => {
    const w = loadWorker()
    seedOldPage(w)
    w.route(SCOPE, () => ok(pageHtml('new')))
    w.route(CSS, () => Promise.resolve(new Response('nope', { status: 404 })))
    const { responded, waits } = w.dispatch(SCOPE, 'navigate')
    const response = await within(responded)
    expect(response).not.toBe(TIMEOUT)
    expect(await (response as Response).text()).toContain('new')
    await Promise.all(waits)
    expect(await text(INDEX, w)).toContain('old')
    expect(await text(SCOPE, w)).toContain('old')
  })

  it('returns_a_500_navigation_to_the_page_but_does_not_cache_it_as_index', async () => {
    const w = loadWorker()
    seedOldPage(w)
    w.route(SCOPE, () => Promise.resolve(new Response(pageHtml('broken'), { status: 500 })))
    const { responded, waits } = w.dispatch(SCOPE, 'navigate')
    const response = (await within(responded)) as Response
    expect(response.status).toBe(500)
    await Promise.all(waits)
    expect(await text(INDEX, w)).toContain('old')
    expect(await text(SCOPE, w)).toContain('old')
  })

  it('serves_cached_index_when_the_network_fails_on_navigation', async () => {
    const w = loadWorker()
    seedOldPage(w)
    w.route(SCOPE, () => Promise.reject(new TypeError('offline')))
    const { responded } = w.dispatch(SCOPE, 'navigate')
    const response = (await within(responded)) as Response
    expect(await response.text()).toContain('old')
  })
})

describe('service worker non-navigation requests', () => {
  const asset = `${SCOPE}data/other.json`

  it('serves_from_cache_without_touching_the_network', async () => {
    const w = loadWorker()
    w.store.set(asset, new Response('cached'))
    const response = await w.dispatch(asset, 'cors').responded
    expect(await response.text()).toBe('cached')
    expect(w.fetched).toEqual([])
  })

  it('fetches_and_caches_a_same_origin_ok_response_on_miss', async () => {
    const w = loadWorker()
    w.route(asset, () => ok('fresh'))
    const response = await w.dispatch(asset, 'cors').responded
    expect(await response.text()).toBe('fresh')
    await flush()
    expect(await text(asset, w)).toBe('fresh')
  })

  it('does_not_cache_a_cross_origin_response', async () => {
    const w = loadWorker()
    const other = 'https://cdn.test/lib.js'
    w.route(other, () => ok('cdn'))
    await w.dispatch(other, 'cors').responded
    await flush()
    expect(w.store.has(other)).toBe(false)
  })

  it('returns_503_when_uncached_and_the_network_fails', async () => {
    const w = loadWorker()
    w.route(asset, () => Promise.reject(new TypeError('offline')))
    const response = await w.dispatch(asset, 'cors').responded
    expect(response.status).toBe(503)
  })
})

describe('static food pages', () => {
  it('leaves_food_pages_and_the_sitemap_to_the_network_and_never_caches_them_as_the_app', async () => {
    const w = loadWorker()
    seedOldPage(w)
    for (const url of [`${SCOPE}foods/fruits/bananas-raw/`, `${SCOPE}foods/foods.css`, `${SCOPE}recipe-calories/`, `${SCOPE}sitemap.xml`, `${SCOPE}robots.txt`]) {
      const { responded, waits } = w.dispatch(url, url.endsWith('/') ? 'navigate' : 'no-cors')
      expect(responded).toBeUndefined()
      expect(waits).toHaveLength(0)
    }
    await flush()
    expect(await text(INDEX, w)).toContain('old')
  })
})

describe('service worker install and warm-up', () => {
  const CATALOG = `${SCOPE}data/usda-common-v2.json`
  const NUTRIENTS = `${SCOPE}data/usda-nutrients-v1.json`
  const CHUNK = `${SCOPE}assets/supabase-9f8e7d.js`
  const installed = async () => {
    const w = loadWorker()
    w.route(INDEX, () => ok(pageHtml('new')))
    await w.lifecycle('install')
    return w
  }

  it('uses_the_v11_cache', () => {
    expect(swSource).toContain("nutrienttrack-shell-v12")
  })

  it('install_fetches_only_the_page_with_no_store_and_leaves_the_catalog_out', async () => {
    const w = await installed()
    expect(w.fetchInit.get(INDEX)).toMatchObject({ cache: 'no-store' })
    expect(w.fetchInit.get(JS)?.cache).toBeUndefined()
    expect(w.fetchInit.get(CSS)?.cache).toBeUndefined()
    expect(w.fetched).not.toContain(CATALOG)
    expect(w.fetched).not.toContain(NUTRIENTS)
    for (const url of [JS, CSS, INDEX]) expect(w.store.has(url)).toBe(true)
  })

  it('warms_the_catalog_after_activation_without_blocking_it', async () => {
    const w = await installed()
    let release: (r: Response) => void = () => {}
    w.route(CATALOG, () => new Promise<Response>((resolve) => { release = resolve }))
    const activated = await within(w.lifecycle('activate'))
    expect(activated).not.toBe(TIMEOUT)
    await flush()
    expect(w.fetched).toContain(CATALOG)
    expect(w.store.has(CATALOG)).toBe(false)
    release(new Response('[]', { status: 200 }))
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(w.store.has(CATALOG)).toBe(true)
  })

  it('warms_the_nutrient_table_after_the_catalog_and_still_warms_it_when_the_catalog_fails', async () => {
    const w = await installed()
    w.route(CATALOG, () => Promise.reject(new TypeError('offline')))
    w.route(NUTRIENTS, () => ok('{}'))
    await w.lifecycle('activate')
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(w.fetched).toContain(NUTRIENTS)
    expect(w.store.has(NUTRIENTS)).toBe(true)
    expect(w.store.has(CATALOG)).toBe(false)
  })

  it('serves_the_catalog_offline_once_warmed_and_caches_it_on_first_fetch_otherwise', async () => {
    const w = await installed()
    w.route(CATALOG, () => ok('[1]'))
    const first = await w.dispatch(CATALOG, 'cors').responded
    expect(await first.text()).toBe('[1]')
    await flush()
    expect(w.store.has(CATALOG)).toBe(true)
    w.route(CATALOG, () => Promise.reject(new TypeError('offline')))
    const second = await w.dispatch(CATALOG, 'cors').responded
    expect(await second.text()).toBe('[1]')
  })

  it('runtime_caches_a_lazy_chunk_on_first_fetch', async () => {
    const w = await installed()
    w.route(CHUNK, () => ok('chunk'))
    expect(await (await w.dispatch(CHUNK, 'cors').responded).text()).toBe('chunk')
    await flush()
    expect(await text(CHUNK, w)).toBe('chunk')
  })
})

describe('service worker label scanner engine', () => {
  const OCR_CACHE = swSource.match(/const OCR_CACHE = '([^']+)'/)?.[1] as string
  const installed = async (others: string[] = []) => {
    const w = loadWorker(swSource, others)
    w.route(INDEX, () => ok(pageHtml('new')))
    await w.lifecycle('install')
    return w
  }
  const OCR = ['worker.min.js', 'core/tesseract-core-simd-lstm.wasm.js', 'lang/eng.traineddata.gz'].map((path) => `${SCOPE}ocr/${path}`)

  it('keeps_the_ocr_engine_out_of_the_install_precache', async () => {
    const w = await installed()
    for (const url of OCR) {
      expect(w.fetched).not.toContain(url)
      expect(w.store.has(url)).toBe(false)
    }
    expect(swSource.slice(swSource.indexOf('const APP_SHELL'), swSource.indexOf(']', swSource.indexOf('const APP_SHELL')))).not.toContain('ocr')
  })

  it('names_the_ocr_cache_after_the_installed_engine_and_model', async () => {
    const core = JSON.parse((await import('../node_modules/tesseract.js-core/package.json?raw')).default) as { version: string }
    const model = JSON.parse((await import('../node_modules/@tesseract.js-data/eng/package.json?raw')).default) as { version: string }
    expect(OCR_CACHE).toContain(`core${core.version}`)
    expect(OCR_CACHE).toContain('eng-4.0.0_best_int')
    expect(model.version).toBeTruthy()
  })

  it('runtime_caches_each_ocr_file_in_its_own_cache_on_first_use_and_serves_it_offline_afterwards', async () => {
    const w = await installed()
    for (const url of OCR) {
      w.route(url, () => ok(`file:${url}`))
      // The worker script and its imports are requested by a worker, not as a page navigation.
      expect(await (await w.dispatch(url, 'same-origin').responded).text()).toBe(`file:${url}`)
    }
    await flush()
    const ocr = w.stores.get(OCR_CACHE) as Map<string, Response>
    for (const url of OCR) expect(await ocr.get(url)?.clone().text()).toBe(`file:${url}`)
    for (const url of OCR) expect(w.store.has(url)).toBe(false)
    for (const url of OCR) w.route(url, () => Promise.reject(new TypeError('offline')))
    const fetchedBefore = w.fetched.length
    for (const url of OCR) expect(await (await w.dispatch(url, 'same-origin').responded).text()).toBe(`file:${url}`)
    expect(w.fetched.length).toBe(fetchedBefore)
  })

  it('does_not_cache_a_failed_ocr_download', async () => {
    const w = await installed()
    w.route(OCR[2], () => Promise.resolve(new Response('', { status: 404 })))
    await w.dispatch(OCR[2], 'same-origin').responded
    await flush()
    expect(w.stores.get(OCR_CACHE)?.has(OCR[2])).toBeFalsy()
  })

  it('keeps_the_ocr_files_when_an_app_update_replaces_the_shell_cache', async () => {
    const w = await installed(['nutrienttrack-shell-v9', OCR_CACHE])
    ;(w.stores.get(OCR_CACHE) as Map<string, Response>).set(OCR[2], new Response('model'))
    await w.lifecycle('activate')
    expect(w.stores.has('nutrienttrack-shell-v9')).toBe(false)
    expect(w.stores.has(OCR_CACHE)).toBe(true)
    expect(await (w.stores.get(OCR_CACHE) as Map<string, Response>).get(OCR[2])?.clone().text()).toBe('model')
  })

  it('deletes_an_older_ocr_cache_when_the_engine_or_model_version_changes', async () => {
    const w = await installed(['nutrienttrack-ocr-core6.9.0-eng-4.0.0_best_int', OCR_CACHE])
    await w.lifecycle('activate')
    expect(w.stores.has('nutrienttrack-ocr-core6.9.0-eng-4.0.0_best_int')).toBe(false)
    expect(w.stores.has(OCR_CACHE)).toBe(true)
  })
})
