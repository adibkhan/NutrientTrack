// @vitest-environment node
// The branded client (src/catalog/branded.ts) against packs built from a synthetic release and served by an in-memory fetch.
import { beforeAll, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The script is plain JavaScript.
import { buildOutput, checkDigitFor, loadProducts } from '../../scripts/build-usda-branded.mjs'
// @ts-expect-error Node only.
import { gzipSync } from 'node:zlib'
import { macros, serveFiles, writeSyntheticRelease, type SyntheticFood } from './brandedTestKit'
import { brandedNutrientSnapshot, createBrandedClient, editDistance, gtinCandidates, gunzipBytes, gunzipPure, gunzipText, isBrandedId, toCatalogFood, type BrandedClient } from './branded'

const food = (fdc: number, gtin: string, brand: string, name: string, extra: Partial<SyntheticFood> = {}): SyntheticFood => ({ fdc, gtin, brand, name, nutrients: macros(5, 5, 30, { '1093': 200, '1079': 3 }), ...extra })

// A case-level GTIN-14 (indicator 1) whose consumer code 0 + body + check has no entry of its own.
const caseBody = '1' + '300001234560'.slice(0, 12)
const caseKey = `${caseBody}${checkDigitFor(caseBody)}`
const consumerBody = caseBody.slice(1)
const consumerKey = `0${consumerBody}${checkDigitFor(consumerBody)}`

const FOODS: SyntheticFood[] = [
  food(1, '016000275287', 'Cheerios', 'Cheerios Cereal', { household: '1 cup', size: '28' }),
  food(2, '016000275294', 'Cheerios', 'Honey Nut Cheerios Cereal Family Size Big Box', { household: '1 cup', size: '37' }),
  food(3, '016000275300', 'General Mills', 'Cheerios Protein Oats & Honey', { household: '1 cup', size: '55' }),
  food(4, '016000275317', 'Trader Joe\'s', 'Cheerio-style O\'s', { household: '1 cup', size: '30' }),
  food(5, '016000275324', 'Chobani', 'Greek Yogurt, Vanilla, Vanilla', { household: '1 container', size: '150' }),
  food(6, '016000275331', 'Chobani', 'Greek Yogurt, Strawberry', { household: '1 container', size: '150' }),
  food(7, '016000275348', 'Fage', 'Greek Yogurt Vanilla', { household: '1 container', size: '170' }),
  food(8, '016000275355', 'Dave\'s Killer Bread', 'Dave\'s Killer Bread, Organic Rockin\' Rye Bread', { household: '1 slice', size: '45' }),
  food(9, '016000275362', 'Oreo', 'OREO Chocolate Sandwich Cookies', { household: '3 cookies', size: '34' }),
  food(10, '016000275379', 'Nabisco', 'Oreo Thins Cookies', { household: '4 cookies', size: '28' }),
  food(11, '016000275386', 'Wild Berry Co', 'Wild Berries Jam', { household: '1 Tbsp', size: '20' }),
  food(12, '016000275393', 'Tropicana', 'Orange Juice', { unit: 'ml', size: '240', household: '8 OZA' }),
  food(13, '016000275409', 'Kirkland Signature', 'Almonds', { household: '1/4 cup', size: '28' }),
  food(14, '016000275416', 'Acme', 'Plain Thing', { size: '', household: '' }),
  food(15, '042100005264', 'Hunts', 'Tomato Sauce', { household: '1/4 cup', size: '62', nutrients: macros(1, 0, 8, { '1114': 2.5, '1093': 300 }) }),
  // Names the old tokeniser could not reach.
  food(20, '016000275423', 'M&M\'s', 'M&M\'s Milk Chocolate Candies', { household: '1 pouch', size: '42' }),
  food(21, '016000275430', 'H-E-B', 'H-E-B Unsweet Almond Milk', { unit: 'ml', size: '240', household: '1 cup' }),
  food(22, '016000275447', 'La Croix', 'Sparkling Water Lime', { unit: 'ml', size: '355', household: '1 can', nutrients: macros(0, 0, 0) }),
  food(23, '016000275454', 'LaCroix', 'Sparkling Water Berry', { unit: 'ml', size: '355', household: '1 can', nutrients: macros(0, 0, 0) }),
  food(24, '016000275461', '365 Everyday Value', 'Peanut Butter Creamy', { household: '2 Tbsp', size: '32' }),
  food(25, '016000275478', 'A&W', 'A&W Root Beer', { unit: 'ml', size: '355', household: '1 can' }),
  food(26, '016000275485', 'Darigold', 'Milk, 2%', { unit: 'ml', size: '240', household: '1 cup' }),
  food(27, '016000275492', 'Darigold', 'Milk, Whole', { unit: 'ml', size: '240', household: '1 cup' }),
  // Two sizes of one product.
  food(28, '016000275508', 'Skippy', 'Peanut Butter Creamy', { household: '2 Tbsp', size: '32' }),
  food(29, '016000275515', 'Skippy', 'Peanut Butter Creamy', { household: '2 Tbsp', size: '34' }),
  food(36, '016000275584', 'Skippy', 'Peanut Butter Creamy', { household: '2 Tbsp', size: '32' }), // the same product again: one size
  food(30, '016000275522', 'Skippy', 'Peanut Butter Chunky', { household: '2 Tbsp', size: '32' }),
  // Words that start like other products' words while a query is being typed.
  food(34, '016000275560', 'Prairie Fresh', 'Pork Shoulder Butt Boneless', { household: '4 oz', size: '112' }),
  food(35, '016000275577', 'Van\'s', 'Van\'s Homestyle Pancakes', { household: '2 pancakes', size: '80' }),
  // Store-local code with a brand, and a case-level GTIN-14 without a consumer entry.
  food(31, '2123456789040', 'Deli Co', 'Sliced Ham', { household: '3 slices', size: '56' }),
  food(32, caseKey, 'Casey', 'Case Crackers', { household: '5 crackers', size: '16' }),
  // USDA lists the only record of this barcode as discontinued: it is still kept, and flagged.
  food(33, `01600027553${checkDigitFor('01600027553')}`, 'Oldco', 'Retired Pudding', { household: '1 cup', size: '120', discontinued: '2021-01-01' }),
]

type TestManifest = { packs: Array<[string, number]>; detail: { starts: number[] }; posts: { first: string[] }; heads: { first: string[] }; summaries: { rows: number }; common: string; brandTokens: string[] }
let files: Record<string, Uint8Array | string>
let manifest: TestManifest
const OPTIONS = { detailRawBytes: 250, blockRows: 4, headMin: 2, headRows: 6, pairMin: 1, pairRows: 6, maxPackBytes: 1200 }

beforeAll(async () => {
  const { products, stats } = await loadProducts(writeSyntheticRelease(FOODS))
  const out = buildOutput(products, stats, OPTIONS)
  files = out.files
  manifest = out.manifest
})

const clientFor = (options: { ranges?: boolean } = {}) => {
  const served = serveFiles(files, options)
  return { client: createBrandedClient({ fetch: served.fetch }), served }
}

describe('fixture sanity', () => {
  it('spans several packs and shards so the Range paths are exercised', () => {
    expect(manifest.packs.length).toBeGreaterThan(1)
    expect(manifest.detail.starts.length).toBeGreaterThan(2)
    expect(manifest.common).toContain('peanut+butter:')
  })
})

describe('barcode lookup', () => {
  it('finds a product by UPC-A, EAN-13, GTIN-14, separators and number', async () => {
    const { client } = clientFor()
    for (const code of ['016000275287', '0016000275287', '00016000275287', '0-16000-27528-7', ' 016000275287 ', 16000275287]) {
      const product = await client.lookupBarcode(code)
      expect(product?.name, String(code)).toBe('Cheerios Cereal')
      expect(product?.gtin).toBe('00016000275287')
    }
  })

  it('finds a UPC-E and prefers a direct EAN-8 hit', async () => {
    const { client } = clientFor()
    expect((await client.lookupBarcode('04252614'))?.name).toBe('Tomato Sauce')
    expect(gtinCandidates('04252614')).toEqual(['00000004252614', '00042100005264'])
    expect(gtinCandidates('012345678905')).toEqual(['00012345678905'])
    expect(gtinCandidates('abc')).toEqual([])
  })

  it('review: store-local codes are never matched by a scan, but a search result can still open them', async () => {
    const { client } = clientFor()
    const reasons: string[] = []
    expect(await client.lookupBarcode('2123456789040', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['not-found'])
    expect((await client.getProduct('2123456789040'))?.name).toBe('Sliced Ham')
    expect((await client.searchBranded('sliced ham'))[0]?.gtin).toBe('02123456789040')
  })

  it('review: a case-level GTIN-14 and the consumer code inside it both find the product', async () => {
    const { client } = clientFor()
    expect((await client.lookupBarcode(consumerKey.slice(1)))?.name).toBe('Case Crackers')
    expect((await client.lookupBarcode(caseKey))?.name).toBe('Case Crackers')
    expect(gtinCandidates(caseKey)).toEqual([caseKey, consumerKey])
  })

  it('reads every field of a record, nutrients absent when unknown', async () => {
    const { client } = clientFor()
    const product = await client.getProduct('042100005264')
    expect(product).toMatchObject({ name: 'Tomato Sauce', brand: 'Hunts', category: 'Snacks', per100: { calories: 36, protein: 1, fat: 0, carbs: 8 }, serving: { size: 62, unit: 'g', household: '1/4 cup', label: '1/4 cup (62 g)' } })
    expect(product?.nutrients).toEqual({ sodium: 300, vitaminD: 2.5 })
    expect(product?.nutrients.fiber).toBeUndefined()
    const plain = await client.getProduct('016000275416')
    expect(plain?.serving).toBeUndefined()
    expect(plain?.fdcId).toBe(14)
    const ml = await client.getProduct('016000275393')
    expect(ml?.serving).toMatchObject({ unit: 'ml', size: 240, label: '8 fl oz (240 ml)' })
  })

  it('review: a discontinued barcode is still found and says so', async () => {
    const { client } = clientFor()
    const product = await client.lookupBarcode(`01600027553${checkDigitFor('01600027553')}`)
    expect(product).toMatchObject({ name: 'Retired Pudding', discontinued: true })
    expect(toCatalogFood(product!).discontinued).toBe(true)
    expect((await client.lookupBarcode('016000275287'))?.discontinued).toBeUndefined()
  })

  it('answers not-found and bad codes without throwing', async () => {
    const { client } = clientFor()
    const reasons: string[] = []
    expect(await client.lookupBarcode('016000999999', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(await client.lookupBarcode('nope', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(await client.lookupBarcode('', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['not-found', 'bad-code', 'bad-code'])
    expect(client.lastReason()).toBe('bad-code')
  })

  it('reads a shard with one Range request and caches the manifest and the decoded shard', async () => {
    const { client, served } = clientFor()
    await client.lookupBarcode('016000275287')
    const first = served.log.length
    expect(served.log[0]?.url).toContain('manifest.json')
    expect(served.log.slice(1).every((entry) => entry.status === 206 && /^bytes=\d+-\d+$/.test(entry.range ?? ''))).toBe(true)
    expect(first).toBe(2)
    await client.lookupBarcode('016000275294')
    expect(served.log.length).toBe(first) // same detail shard, nothing refetched
    expect(client.stats.bytes).toBeGreaterThan(0)
  })
})

describe('servers that ignore Range', () => {
  it('uses the body when it is small (a tiny pack), slicing the shard out of it', async () => {
    const { client } = clientFor({ ranges: false })
    expect((await client.lookupBarcode('016000275287'))?.name).toBe('Cheerios Cereal')
    expect(client.stats.fullPackFallbacks).toBeGreaterThanOrEqual(1)
  })

  it('review: a large 200 answer stops after one event: the body is cancelled, the pack is switched off, no later download', async () => {
    const requests: string[] = []
    let cancelled = 0
    const servedManifest = serveFiles(files)
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return servedManifest.fetch(input, init)
      requests.push(url)
      const body = new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(new Uint8Array(65536)), cancel: () => { cancelled += 1 } })
      return new Response(body, { status: 200, headers: { 'content-length': '25000000' } })
    }) as typeof fetch
    const client = createBrandedClient({ fetch: fetchImpl })
    const reasons: string[] = []
    expect(await client.lookupBarcode('016000275287', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['range-unsupported'])
    expect(cancelled).toBe(1)
    const after = requests.length
    expect(await client.lookupBarcode('016000275294', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['range-unsupported', 'range-unsupported'])
    expect(requests.length).toBe(after) // that pack is not asked for again
    // A search on such a server still ends promptly with a reason.
    const started = Date.now()
    expect(await client.searchBranded('cheerios', { timeoutMs: 500 })).toEqual([])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('an unknown-length large 200 is cut off at the limit', async () => {
    const servedManifest = serveFiles(files)
    let pulled = 0
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('manifest.json')) return servedManifest.fetch(input, init)
      return new Response(new ReadableStream<Uint8Array>({ pull: (controller) => { pulled += 1; controller.enqueue(new Uint8Array(500_000)) } }), { status: 200 })
    }) as typeof fetch
    const client = createBrandedClient({ fetch: fetchImpl })
    expect(await client.lookupBarcode('016000275287')).toBeUndefined()
    expect(client.lastReason()).toBe('range-unsupported')
    expect(pulled).toBeLessThan(10)
  })
})

describe('failure handling', () => {
  it('resolves empty with a reason when offline, and recovers later', async () => {
    let online = false
    const served = serveFiles(files)
    const client = createBrandedClient({ fetch: ((input: RequestInfo | URL, init?: RequestInit) => (online ? served.fetch(input, init) : Promise.reject(new TypeError('Failed to fetch')))) as typeof fetch })
    const reasons: string[] = []
    expect(await client.searchBranded('cheerios', { onReason: (reason) => reasons.push(reason) })).toEqual([])
    expect(await client.lookupBarcode('016000275287', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(await client.loadManifest({ onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['offline', 'offline', 'offline'])
    online = true
    expect((await client.lookupBarcode('016000275287'))?.name).toBe('Cheerios Cereal') // the failed manifest was not remembered
    expect((await client.searchBranded('cheerios')).length).toBeGreaterThan(0)
    expect(client.lastReason()).toBeUndefined()
  })

  it('review: a 503 from the offline service worker is "offline", not a bad response', async () => {
    const served = serveFiles(files)
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith('manifest.json') ? served.fetch(input, init) : new Response('offline', { status: 503 }))) as typeof fetch
    const client = createBrandedClient({ fetch: fetchImpl })
    const reasons: string[] = []
    expect(await client.lookupBarcode('016000275287', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(await client.searchBranded('cheerios', { onReason: (reason) => reasons.push(reason) })).toEqual([])
    const manifestDown = createBrandedClient({ fetch: (async () => new Response('', { status: 503 })) as typeof fetch })
    expect(await manifestDown.loadManifest({ onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['offline', 'offline', 'offline'])
  })

  it('times out a request that never answers', async () => {
    const client = createBrandedClient({ fetch: (() => new Promise(() => undefined)) as typeof fetch })
    const reasons: string[] = []
    const started = Date.now()
    expect(await client.searchBranded('cheerios', { timeoutMs: 40, onReason: (reason) => reasons.push(reason) })).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
    expect(reasons).toEqual(['timeout'])
  })

  it('honours an abort signal', async () => {
    const { client } = clientFor()
    const controller = new AbortController()
    controller.abort()
    const reasons: string[] = []
    expect(await client.searchBranded('cheerios', { signal: controller.signal, onReason: (reason) => reasons.push(reason) })).toEqual([])
    expect(reasons).toEqual(['aborted'])
  })

  it('rejects a broken manifest, a short Range body and a corrupt shard', async () => {
    const reasons: string[] = []
    const onReason = (reason: string) => reasons.push(reason)
    const badManifest = createBrandedClient({ fetch: serveFiles({ ...files, 'manifest.json': '{"version":9}' }).fetch })
    expect(await badManifest.lookupBarcode('016000275287', { onReason: onReason as never })).toBeUndefined()
    const notJson = createBrandedClient({ fetch: serveFiles({ ...files, 'manifest.json': '<html>' }).fetch })
    expect(await notJson.searchBranded('cheerios', { onReason: onReason as never })).toEqual([])
    const corrupt: Record<string, Uint8Array | string> = { ...files }
    for (const [name, size] of manifest.packs) corrupt[name] = new Uint8Array(size).fill(7)
    const corruptClient = createBrandedClient({ fetch: serveFiles(corrupt).fetch })
    expect(await corruptClient.lookupBarcode('016000275287', { onReason: onReason as never })).toBeUndefined()
    const wrong = createBrandedClient({ fetch: (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith('manifest.json') ? serveFiles(files).fetch(input, init) : new Response(new Uint8Array(3), { status: 206 }))) as typeof fetch })
    expect(await wrong.lookupBarcode('016000275287', { onReason: onReason as never })).toBeUndefined()
    expect(reasons).toEqual(['bad-manifest', 'bad-manifest', 'bad-shard', 'bad-response'])
  })

  it('never throws when fetch is missing', async () => {
    const client = createBrandedClient({ fetch: undefined })
    vi.stubGlobal('fetch', undefined)
    try {
      expect(await client.searchBranded('cheerios')).toEqual([])
      expect(client.lastReason()).toBe('offline')
    } finally { vi.unstubAllGlobals() }
  })

  it('uses an injected shard cache, fills it only with shards that decode, and refetches a bad cached copy', async () => {
    const stored = new Map<string, Uint8Array>()
    const served = serveFiles(files)
    const cache = { get: (key: string) => stored.get(key), put: (key: string, bytes: Uint8Array) => { stored.set(key, bytes) } }
    const first = createBrandedClient({ fetch: served.fetch, shardCache: cache })
    await first.lookupBarcode('016000275287')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(stored.size).toBe(1)
    const before = served.log.length
    const second = createBrandedClient({ fetch: served.fetch, shardCache: cache })
    await second.lookupBarcode('016000275287')
    expect(served.log.length - before).toBe(1) // only the manifest
    // A cached copy that does not decode is ignored and replaced by a fresh fetch.
    const [key, bytes] = [...stored.entries()][0] as [string, Uint8Array]
    stored.set(key, new Uint8Array(bytes.length).fill(9))
    const third = createBrandedClient({ fetch: served.fetch, shardCache: cache })
    expect((await third.lookupBarcode('016000275287'))?.name).toBe('Cheerios Cereal')
    expect(stored.get(key)).toEqual(bytes)
  })
})

describe('review: shared in-flight requests', () => {
  const slow = (inner: typeof fetch, ms: number) => ((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => inner(input, init).then(resolve, reject), ms)
    init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) })
  })) as typeof fetch

  it('one caller aborting never fails another caller waiting on the same manifest and shard', async () => {
    const served = serveFiles(files)
    const client = createBrandedClient({ fetch: slow(served.fetch, 15) })
    const controller = new AbortController()
    const reasonsA: string[] = []
    const a = client.lookupBarcode('016000275287', { signal: controller.signal, onReason: (reason) => reasonsA.push(reason) })
    const b = client.lookupBarcode('016000275287')
    setTimeout(() => controller.abort(), 5)
    expect(await a).toBeUndefined()
    expect(reasonsA).toEqual(['aborted'])
    expect((await b)?.name).toBe('Cheerios Cereal')
    expect(served.log.filter((entry) => entry.url.includes('manifest')).length).toBe(1)
  })

  it('one caller timing out never fails another with a longer budget', async () => {
    const served = serveFiles(files)
    const client = createBrandedClient({ fetch: slow(served.fetch, 40) })
    const reasons: string[] = []
    const short = client.searchBranded('cheerios', { timeoutMs: 10, onReason: (reason) => reasons.push(reason) })
    const long = client.searchBranded('cheerios', { timeoutMs: 5000 })
    expect(await short).toEqual([])
    expect(reasons).toEqual(['timeout'])
    expect((await long).length).toBeGreaterThan(0)
  })

  it('cancels the network request only when every caller is gone', async () => {
    let aborted = 0
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted += 1; reject(new DOMException('aborted', 'AbortError')) })
    })) as typeof fetch
    const client = createBrandedClient({ fetch: fetchImpl })
    const one = new AbortController()
    const two = new AbortController()
    const a = client.loadManifest({ signal: one.signal })
    const b = client.loadManifest({ signal: two.signal })
    one.abort()
    await a
    expect(aborted).toBe(0)
    two.abort()
    await b
    expect(aborted).toBe(1)
  })

  it('latestOnly: a search that a newer one overtakes resolves empty as stale', async () => {
    const served = serveFiles(files)
    const client = createBrandedClient({ fetch: slow(served.fetch, 10) })
    const reasons: string[] = []
    const old = client.searchBranded('chee', { latestOnly: true, onReason: (reason) => reasons.push(reason) })
    const fresh = client.searchBranded('cheerios', { latestOnly: true })
    expect(await old).toEqual([])
    expect(reasons).toEqual(['stale'])
    const results = await fresh
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((item) => item.query === 'cheerios')).toBe(true)
    // Without the flag both complete.
    const both = await Promise.all([client.searchBranded('greek'), client.searchBranded('oreo')])
    expect(both[0].length).toBeGreaterThan(0)
    expect(both[1].length).toBeGreaterThan(0)
  })

  it('every result carries the query it answers', async () => {
    const { client } = clientFor()
    const results = await client.searchBranded('Greek Yogurt')
    expect(results.length).toBeGreaterThan(0)
    expect(new Set(results.map((item) => item.query))).toEqual(new Set(['Greek Yogurt']))
  })
})

describe('review: manifest staleness', () => {
  it('a 404 for a pack named in a cached manifest refetches the manifest once with cache "reload" and retries', async () => {
    const { products, stats } = await loadProducts(writeSyntheticRelease([...FOODS, food(99, '016000275999', 'Newcomer', 'Brand New Thing', { household: '1 cup', size: '30' })]))
    const next = buildOutput(products, stats, OPTIONS)
    expect(Object.keys(next.files).filter((name) => name.endsWith('.bin'))).not.toEqual(Object.keys(files).filter((name) => name.endsWith('.bin')))
    let live: Record<string, Uint8Array | string> = files
    const modes: Array<string | undefined> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('manifest.json')) modes.push(init?.cache)
      return serveFiles(live).fetch(input, init)
    }) as typeof fetch
    const client = createBrandedClient({ fetch: fetchImpl })
    expect((await client.lookupBarcode('016000275287'))?.name).toBe('Cheerios Cereal')
    live = next.files // a deploy: new pack names, the old ones are gone
    const another = await client.lookupBarcode('016000275999')
    expect(another?.name).toBe('Brand New Thing')
    expect(modes).toEqual(['force-cache', 'reload'])
    // A manifest that did not change does not loop.
    live = files
    const lone = createBrandedClient({ fetch: fetchImpl })
    const gone = { ...files }
    for (const name of Object.keys(gone)) if (name.endsWith('.bin')) delete gone[name]
    live = gone
    const reasons: string[] = []
    expect(await lone.lookupBarcode('016000275287', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
    expect(reasons).toEqual(['bad-response'])
  })
})

describe('pack failures (review H2) and slow links (review M6)', () => {
  it('reads packs with the default cache mode, not force-cache', async () => {
    const modes: Array<string | undefined> = []
    const served = serveFiles(files)
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input).endsWith('.bin')) modes.push(init?.cache); return served.fetch(input, init) }) as typeof fetch
    await createBrandedClient({ fetch: fetchImpl }).lookupBarcode('016000275287')
    expect(modes.length).toBeGreaterThan(0)
    expect(new Set(modes)).toEqual(new Set(['default']))
  })

  it('a 404 for a pack retries once past the HTTP cache even when the manifest did not change, then backs off for 10 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const served = serveFiles(files)
      const modes: Array<string | undefined> = []
      let broken = true
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('.bin')) { modes.push(init?.cache); if (broken && init?.cache !== 'reload') return new Response('', { status: 404 }) }
        return served.fetch(input, init)
      }) as typeof fetch
      const client = createBrandedClient({ fetch: fetchImpl })
      expect((await client.lookupBarcode('016000275287'))?.name).toBe('Cheerios Cereal') // the reload bypassed the cached 404
      expect(modes).toContain('reload')
      // A pack that stays broken fails fast for 10 s and is asked for again afterwards.
      const dead = createBrandedClient({ fetch: (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith('.bin') ? new Response('', { status: 404 }) : served.fetch(input, init))) as typeof fetch })
      const reasons: string[] = []
      expect(await dead.lookupBarcode('016000275287', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
      const before = dead.stats.requests
      expect(await dead.lookupBarcode('016000275287', { onReason: (reason) => reasons.push(reason) })).toBeUndefined()
      expect(dead.stats.requests).toBe(before) // inside the back-off: no pack request
      vi.setSystemTime(Date.now() + 11_000)
      await dead.lookupBarcode('016000275287')
      expect(dead.stats.requests).toBeGreaterThan(before)
      broken = false
      expect(reasons).toEqual(['bad-response', 'bad-response'])
    } finally { vi.useRealTimers() }
  })

  it('a short pack body counts as a bad answer and is retried past the cache', async () => {
    const served = serveFiles(files)
    const modes: Array<string | undefined> = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await served.fetch(input, init)
      if (String(input).endsWith('.bin')) { modes.push(init?.cache); if (init?.cache !== 'reload') return new Response((await response.arrayBuffer()).slice(0, 3), { status: 206 }) }
      return response
    }) as typeof fetch
    expect((await createBrandedClient({ fetch: fetchImpl }).lookupBarcode('016000275287'))?.name).toBe('Cheerios Cereal')
    expect(modes).toContain('reload')
  })

  it('warm() loads the manifest and the popularity list once, on a signal nothing can abort', async () => {
    const { client, served } = clientFor()
    await client.warm()
    const afterWarm = served.log.length
    expect(afterWarm).toBeGreaterThan(0)
    const controller = new AbortController()
    controller.abort()
    expect(await client.searchBranded('cheerios', { signal: controller.signal })).toEqual([])
    await client.warm()
    expect(served.log.length).toBe(afterWarm)
  })

  it('a search that times out is tried once more automatically and reports a timeout only when both attempts time out', async () => {
    const served = serveFiles(files)
    let stall = 1
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('.bin') && stall > 0) { stall -= 1; return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) }
      return served.fetch(input, init)
    }) as typeof fetch
    const client = createBrandedClient({ fetch: fetchImpl })
    const reasons: string[] = []
    const rows = await client.searchBranded('cheerios', { timeoutMs: 150, onReason: (reason) => reasons.push(reason) })
    expect(rows.length).toBeGreaterThan(0)
    expect(reasons).toEqual([])
    stall = 100
    const slow = createBrandedClient({ fetch: fetchImpl })
    expect(await slow.searchBranded('cheerios', { timeoutMs: 100, onReason: (reason) => reasons.push(reason) })).toEqual([])
    expect(reasons).toEqual(['timeout'])
  })
})

describe('search', () => {
  const names = async (client: BrandedClient, query: string, limit = 10) => (await client.searchBranded(query, { limit })).map((item) => item.name)
  const brands = async (client: BrandedClient, query: string, limit = 10) => (await client.searchBranded(query, { limit })).map((item) => `${item.brand}: ${item.name}`)

  it('requires every query word to match, in any order', async () => {
    const { client } = clientFor()
    expect((await names(client, 'greek vanilla')).sort()).toEqual(['Greek Yogurt Vanilla', 'Greek Yogurt, Vanilla'])
    expect((await names(client, 'vanilla greek')).sort()).toEqual(['Greek Yogurt Vanilla', 'Greek Yogurt, Vanilla'])
    expect(await names(client, 'chobani vanilla')).toEqual(['Greek Yogurt, Vanilla'])
    expect(await names(client, 'chobani zzz')).toEqual([])
    expect(await names(client, 'yogu')).toHaveLength(3)
  })

  it('the word being typed is a prefix union and no earlier word is dropped (review prefix.mjs)', async () => {
    const { client } = clientFor()
    expect(await names(client, 'peanut butt')).toEqual(await names(client, 'peanut butter'))
    expect((await names(client, 'peanut butt')).every((name) => /peanut butter/i.test(name))).toBe(true)
    expect((await names(client, 'chobani van')).sort()).toEqual(['Greek Yogurt, Vanilla'])
    expect(await names(client, 'chobani vanil')).toEqual(['Greek Yogurt, Vanilla'])
    expect(await names(client, 'greek yogurt vani')).toHaveLength(2)
    // The exact short word is part of the union: "van" alone still finds Van's.
    expect((await names(client, 'van')).length).toBeGreaterThan(0)
  })

  it('words that never meet in one product give nothing, not results without a word', async () => {
    const { client } = clientFor()
    expect(await names(client, 'peanut pancakes')).toEqual([])
    expect(await names(client, 'chobani pancak')).toEqual([])
  })

  it('a misspelling is repaired only when the query read as typed finds nothing, preferring the commoner word', async () => {
    const { client } = clientFor()
    expect(await names(client, 'peanut buter')).toEqual(await names(client, 'peanut butter'))
    expect((await names(client, 'chobanni')).length).toBeGreaterThan(0)
  })

  it('review: m&m, m and m, h-e-b, la croix, lacroix, 365, a&w all find their products', async () => {
    const { client } = clientFor()
    for (const query of ['m&m', 'm&ms', 'mms', 'm and m', 'M&M\'s chocolate']) expect(await names(client, query), query).toEqual(['M&M\'s Milk Chocolate Candies'])
    for (const query of ['h-e-b', 'heb', 'h e b almond']) expect(await names(client, query), query).toEqual(['H-E-B Unsweet Almond Milk'])
    expect((await brands(client, 'la croix')).sort()).toEqual(['La Croix: Sparkling Water Lime', 'LaCroix: Sparkling Water Berry'].sort())
    expect((await brands(client, 'lacroix')).sort()).toEqual(['La Croix: Sparkling Water Lime', 'LaCroix: Sparkling Water Berry'].sort())
    expect(await names(client, '365')).toEqual(['Peanut Butter Creamy'])
    for (const query of ['a&w', 'a & w', 'a and w root beer']) expect(await names(client, query), query).toEqual(['A&W Root Beer'])
  })

  it('review: a numeric qualifier filters: 2% milk is not whole milk', async () => {
    const { client } = clientFor()
    expect(await names(client, '2% milk')).toEqual(['Milk, 2%'])
    expect(await names(client, 'milk 2%')).toEqual(['Milk, 2%'])
    expect((await names(client, 'darigold milk')).sort()).toEqual(['Milk, 2%', 'Milk, Whole'])
  })

  it('review: a misspelt brand is repaired (edit distance 1 from five letters, 2 from eight)', async () => {
    const { client } = clientFor()
    expect((await names(client, 'chobanni')).sort()).toEqual(['Greek Yogurt, Strawberry', 'Greek Yogurt, Vanilla'])
    expect((await names(client, 'chobbani')).length).toBe(2)
    expect(await names(client, 'chob')).toHaveLength(2) // a prefix, not a typo
    expect(await names(client, 'xyzzy')).toEqual([])
    expect(editDistance('chobanni', 'chobani', 1)).toBe(1)
    expect(editDistance('chobani', 'chobain', 1)).toBe(1) // a swap
    expect(editDistance('abc', 'abcdef', 2)).toBe(3)
  })

  it('review: a one-word query on a common word is one request (its head); several words are answered exactly from the postings', async () => {
    const { client, served } = clientFor()
    await client.loadManifest()
    const before = served.log.length
    expect((await client.searchBranded('butter')).length).toBeGreaterThan(0)
    expect(served.log.length - before).toBe(1)
    const start = served.log.length
    const results = await client.searchBranded('peanut butter')
    expect(served.log.length - start).toBeLessThanOrEqual(6)
    expect(results.map((item) => item.brand).sort()).toEqual(['365 Everyday Value', 'Skippy', 'Skippy'].sort())
  })

  it('review: a large match set is ranked by popularity first and only the blocks of its best candidates are read', async () => {
    const big: SyntheticFood[] = Array.from({ length: 120 }, (_unused, index) => {
      const body = `07${String(1000 + index).padStart(9, '0')}`
      return food(900 + index, `${body}${checkDigitFor(body)}`, index < 70 ? 'Big Brand' : index < 100 ? 'Mid Brand' : 'Tiny Brand', `Crunchy Snack ${index}`, { household: '1 bag', size: '30' })
    })
    const { products, stats } = await loadProducts(writeSyntheticRelease(big))
    const out = buildOutput(products, stats, { ...OPTIONS, maxPackBytes: 100000 })
    const served = serveFiles(out.files)
    const client = createBrandedClient({ fetch: served.fetch })
    await client.loadManifest()
    const start = served.log.length
    const results = await client.searchBranded('crunchy snack', { limit: 10 })
    expect(results).toHaveLength(10)
    expect(new Set(results.map((item) => item.brand))).toEqual(new Set(['Big Brand'])) // the biggest brand is the most popular
    const requests = served.log.slice(start)
    expect(requests.length).toBeLessThanOrEqual(8) // postings (2) + popularity + at most 4 blocks of 4 rows (120 candidates, 30 blocks)
    expect(requests.filter((entry) => entry.range).length).toBe(requests.length)
    // The popularity shard is fetched once.
    const again = served.log.length
    await client.searchBranded('crunchy snack', { limit: 10 })
    expect(served.log.length).toBe(again)
    // The whole match set can be asked for: unlimited reads every block and returns every product.
    const all = await client.searchBranded('crunchy snack', { limit: 1000, maxShards: 1000 })
    expect(all).toHaveLength(120)
  })

  it('review: a rare word with a huge partner is exact: every product with both words is found', async () => {
    const { client } = clientFor()
    const all = await client.searchBranded('greek yogurt', { limit: 100, maxShards: 1000 })
    expect(all.map((item) => item.brand).sort()).toEqual(['Chobani', 'Chobani', 'Fage'])
    const fage = await client.searchBranded('fage greek yogurt vanilla', { limit: 100 })
    expect(fage.map((item) => item.brand)).toEqual(['Fage'])
  })

  it('review: identical brand and name collapse into one result with a distinct size count and one barcode per size', async () => {
    const { client } = clientFor()
    const results = await client.searchBranded('skippy peanut butter')
    expect(results.map((item) => item.name)).toEqual(['Peanut Butter Creamy', 'Peanut Butter Chunky'])
    expect(results[0]).toMatchObject({ sizes: 2, variants: ['00016000275508', '00016000275515'] })
    expect(results[1]?.sizes).toBeUndefined()
  })

  it('review: a name match outranks a match on a multi-word brand for a generic word', async () => {
    const { client } = clientFor()
    const results = await brands(client, 'cheerios')
    expect(results[0]).toBe('Cheerios: Cheerios Cereal')
    expect(results.indexOf('General Mills: Cheerios Protein Oats & Honey')).toBeGreaterThan(-1)
  })

  it('ranks whole-word matches before prefix matches, brand matches up, and shorter names first', async () => {
    const { client } = clientFor()
    const results = await client.searchBranded('cheerios', { limit: 10 })
    expect(results.map((item) => item.name).sort()).toEqual(['Cheerio-style O\'s', 'Cheerios Cereal', 'Cheerios Protein Oats & Honey', 'Honey Nut Cheerios Cereal Family Size Big Box'].sort())
    expect(results[0]?.name).toBe('Cheerios Cereal')
    expect((await names(client, 'oreo'))[0]).toBe('OREO Chocolate Sandwich Cookies')
    expect((await names(client, 'cheer')).length).toBe(4)
    expect(await names(clientFor().client, 'cheerios')).toEqual(await names(client, 'cheerios'))
  })

  it('finds by brand, with an apostrophe or not, and respects the limit', async () => {
    const { client } = clientFor()
    expect(await names(client, "dave's killer bread")).toEqual(["Dave's Killer Bread, Organic Rockin' Rye Bread"])
    expect(await names(client, 'daves')).toEqual(["Dave's Killer Bread, Organic Rockin' Rye Bread"])
    expect(await names(client, 'trader joe')).toEqual(["Cheerio-style O's"])
    expect(await names(client, 'cheerios', 2)).toHaveLength(2)
  })

  it('tolerates plurals and the stemmer\'s y/ie split, also while typing', async () => {
    const { client } = clientFor()
    expect(await names(client, 'cookie')).toHaveLength(2)
    expect(await names(client, 'cookies')).toHaveLength(2)
    expect((await names(client, 'berry')).sort()).toEqual(['Sparkling Water Berry', 'Wild Berries Jam'])
    expect((await names(client, 'berries')).sort()).toEqual(['Sparkling Water Berry', 'Wild Berries Jam'])
    expect((await names(client, 'berrie')).sort()).toEqual(['Sparkling Water Berry', 'Wild Berries Jam'])
    expect(await names(client, 'Crème')).toEqual([])
  })

  it('returns summaries with a serving label, per-100 kcal and the unit of a liquid', async () => {
    const { client } = clientFor()
    const [item] = await client.searchBranded('tropicana')
    expect(item).toEqual({ gtin: '00016000275393', name: 'Orange Juice', brand: 'Tropicana', kcal: 185, serving: '8 fl oz (240 ml)', query: 'tropicana', unit: 'ml' })
    expect(await client.getProduct(item?.gtin as string)).toMatchObject({ name: 'Orange Juice', serving: { unit: 'ml' } })
  })

  it('is empty for nothing searchable and says why', async () => {
    const { client, served } = clientFor()
    const reasons: string[] = []
    expect(await client.searchBranded('', { onReason: (reason) => reasons.push(reason) })).toEqual([])
    expect(await client.searchBranded('the and oz', { onReason: (reason) => reasons.push(reason) })).toEqual([])
    expect(reasons).toEqual(['empty-query', 'empty-query'])
    expect(served.log.filter((entry) => entry.range).length).toBe(0)
    expect(await client.searchBranded('qqqqq')).toEqual([])
  })

  it('bounds the requests of one query', async () => {
    const { client, served } = clientFor()
    await client.loadManifest()
    const before = served.log.length
    await client.searchBranded('cheerios honey nut cereal family size')
    await client.searchBranded('c', { maxShards: 1 })
    expect(served.log.length - before).toBeLessThanOrEqual(12)
    const single = createBrandedClient({ fetch: serveFiles(files).fetch })
    await single.loadManifest()
    const start = single.stats.requests
    await single.searchBranded('greek yogurt vanilla chobani strawberry fage')
    expect(single.stats.requests - start).toBeLessThanOrEqual(6)
  })
})

describe('CatalogFood bridge', () => {
  it('maps a product to the shape the app uses', async () => {
    const { client } = clientFor()
    const product = await client.getProduct('016000275294')
    const catalog = toCatalogFood(product!)
    expect(catalog).toEqual({ id: 'usda-branded-00016000275294', fdcId: 2, name: 'Honey Nut Cheerios Cereal Family Size Big Box', category: 'Snacks', source: 'USDA Branded', per100g: { calories: 185, protein: 5, carbs: 30, fat: 5 }, portions: [['1 cup (37 g)', 37]], brand: 'Cheerios', gtin: '00016000275294' })
    expect(isBrandedId(catalog.id)).toBe(true)
    expect(isBrandedId('usda-sr-1')).toBe(false)
    expect(toCatalogFood((await client.getProduct('016000275379'))!).name).toBe('Nabisco Oreo Thins Cookies')
    expect(toCatalogFood((await client.getProduct('016000275416'))!).portions).toBeUndefined()
  })

  it('review: a liquid keeps its unit instead of being converted to grams', async () => {
    const { client } = clientFor()
    const juice = toCatalogFood((await client.getProduct('016000275393'))!)
    expect(juice.unit).toBe('ml')
    expect(juice.portions).toEqual([['8 fl oz (240 ml)', 240]])
    expect(toCatalogFood((await client.getProduct('016000275287'))!).unit).toBeUndefined()
  })

  it('snapshots nutrients scaled to grams, absent staying absent', async () => {
    const { client } = clientFor()
    const sauce = (await client.getProduct('042100005264'))!
    expect(brandedNutrientSnapshot(sauce, 62)).toEqual({ sodium: 186, vitaminD: 1.55 })
    expect(brandedNutrientSnapshot(sauce, 0)).toEqual({})
    expect('fiber' in brandedNutrientSnapshot(sauce, 100)).toBe(false)
    const cereal = (await client.getProduct('016000275287'))!
    expect(brandedNutrientSnapshot(cereal, 28)).toEqual({ sodium: 56, fiber: 0.84 })
  })
})

describe('gunzip', () => {
  const sample = `${'tokens and rows\t12\tg\n'.repeat(400)}${Array.from({ length: 300 }, (_, index) => `${(index * 7919) % 1000}\tüñí ${index}`).join('\n')}`
  const gz = gzipSync(sample, { level: 9 }) as Uint8Array

  it('the pure inflate matches the browser stream on dynamic blocks', async () => {
    expect(new TextDecoder().decode(gunzipPure(gz))).toBe(sample)
    expect(await gunzipText(gz)).toBe(sample)
  })

  it('falls back to the pure inflate when DecompressionStream is missing or cannot be built', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    try { expect(await gunzipText(gz)).toBe(sample) } finally { vi.unstubAllGlobals() }
    vi.stubGlobal('DecompressionStream', class { constructor() { throw new Error('unsupported') } })
    try { expect(await gunzipText(gz)).toBe(sample) } finally { vi.unstubAllGlobals() }
  })

  it('review: a data error from the native decoder is final: the pure inflate is not tried on the same bytes', async () => {
    class Failing { readable: ReadableStream; writable: WritableStream
      constructor() {
        const transform = new TransformStream({ transform: (_chunk, controller) => controller.error(new TypeError('Decompression failed')) })
        this.readable = transform.readable
        this.writable = transform.writable
      } }
    vi.stubGlobal('DecompressionStream', Failing)
    try {
      await expect(gunzipBytes(gz)).rejects.toThrow()
      expect(new TextDecoder().decode(gunzipPure(gz))).toBe(sample) // the pure decoder alone would have succeeded
    } finally { vi.unstubAllGlobals() }
  })

  it('review: the pure gunzip verifies the CRC-32 and the length in the trailer', () => {
    const flipped = Uint8Array.from(gz)
    flipped[flipped.length - 8] = (flipped[flipped.length - 8] as number) ^ 0x01 // CRC
    expect(() => gunzipPure(flipped)).toThrow(/Corrupt/)
    const sized = Uint8Array.from(gz)
    sized[sized.length - 4] = (sized[sized.length - 4] as number) ^ 0x01 // ISIZE
    expect(() => gunzipPure(sized)).toThrow(/Corrupt/)
    // A payload byte flipped inside a stored block decodes but fails the CRC.
    const stored = gzipSync('stored stored stored', { level: 0 }) as Uint8Array
    const damaged = Uint8Array.from(stored)
    damaged[20] = (damaged[20] as number) ^ 0x20
    expect(() => gunzipPure(damaged)).toThrow(/Corrupt/)
  })

  it('review: a corrupt shard (bad CRC) makes lookups and searches report bad-shard', async () => {
    const reasons: string[] = []
    const damaged: Record<string, Uint8Array | string> = { ...files }
    const [name] = manifest.packs[0] as [string, number]
    const pack = Uint8Array.from(files[name] as Uint8Array)
    // Flip the CRC byte of every gzip member's trailer by corrupting a run in the middle of each shard region: simplest is to damage the whole pack body.
    for (let at = 40; at < pack.length; at += 17) pack[at] = (pack[at] as number) ^ 0x55
    damaged[name] = pack
    const client = createBrandedClient({ fetch: serveFiles(damaged).fetch, gunzip: async (bytes) => gunzipPure(bytes) })
    for (const code of ['016000275287', '016000275294', '042100005264', '016000275300']) await client.lookupBarcode(code, { onReason: (reason) => reasons.push(reason) })
    expect(reasons.length).toBeGreaterThan(0)
    expect(new Set(reasons)).toEqual(new Set(['bad-shard']))
  })

  it('handles fixed-Huffman, stored and empty streams and rejects garbage', () => {
    for (const level of [0, 1, 9]) for (const text of ['', 'a', 'hello hello hello hello', 'x'.repeat(70000)]) expect(new TextDecoder().decode(gunzipPure(gzipSync(text, { level })))).toBe(text)
    expect(() => gunzipPure(new Uint8Array(40).fill(1))).toThrow()
    expect(() => gunzipPure(gz.slice(0, 30))).toThrow()
  })

  it('every shard of the synthetic build decodes with the pure inflate too', async () => {
    for (const [name, size] of manifest.packs) expect((files[name] as Uint8Array).length).toBe(size)
    const client = createBrandedClient({ fetch: serveFiles(files).fetch, gunzip: async (bytes) => gunzipPure(bytes) })
    const why: string[] = []
    expect((await client.lookupBarcode('016000275287', { onReason: (reason) => why.push(reason) }))?.name, why.join()).toBe('Cheerios Cereal')
    expect((await client.searchBranded('greek')).length).toBe(3)
  })
})
