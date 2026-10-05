import { describe, expect, it } from 'vitest'
import swSource from '../public/sw.js?raw'

const SCOPE = 'https://app.test/'
const CACHE_NAME = 'nutrienttrack-shell-v7'
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

const loadWorker = (source: string = swSource) => {
  const store = new Map<string, Response>()
  const keyOf = (r: Keyed) => (typeof r === 'string' ? r : r.url)
  const cache = {
    match: async (r: Keyed) => store.get(keyOf(r))?.clone(),
    put: async (r: Keyed, res: Response) => void store.set(keyOf(r), res),
    addAll: async () => {},
    keys: async () => [...store.keys()],
    delete: async (r: string) => store.delete(r),
  }
  const caches = {
    open: async () => cache,
    match: async (r: Keyed) => cache.match(r),
    keys: async () => [CACHE_NAME],
    delete: async () => true,
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
  const fakeFetch = (input: Keyed) => {
    const url = keyOf(input)
    fetched.push(url)
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
  return {
    store,
    fetched,
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
