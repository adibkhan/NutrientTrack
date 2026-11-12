import { describe, expect, it } from 'vitest'
import { BRANDED_CACHE_NAME, createShardCache as create, manifestFingerprint, shardPath } from './brandedCache'

const createShardCache = (options: Omit<Parameters<typeof create>[0], 'scope'> & { scope?: () => Promise<string | undefined> }) => create({ scope: async () => 'fp1', ...options })

/** A Cache API in memory: keys are full URLs, as in a browser. */
const fakeStorage = () => {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const mine = stores.get(name) as Map<string, Response>
    return {
      match: async (url: string) => mine.get(url)?.clone(),
      put: async (url: string, response: Response) => void mine.set(url, response),
      delete: async (url: string) => mine.delete(url),
      keys: async () => [...mine.keys()].map((url) => ({ url })),
    } as unknown as Cache
  }
  return { stores, storage: { open } as Pick<CacheStorage, 'open'> }
}
const bytes = (...values: number[]) => new Uint8Array(values)
const KEY = 'branded-p00-145802fbd397.bin:120:48'

describe('shardPath', () => {
  it('turns the client key into a synthetic path', () => expect(shardPath(KEY, 'fp1')).toBe('/__branded/fp1/branded-p00-145802fbd397.bin/120-48'))
})

describe('createShardCache', () => {
  it('returns what was put, byte for byte, under a synthetic same-origin URL in the branded cache', async () => {
    const { stores, storage } = fakeStorage()
    const cache = createShardCache({ storage, origin: 'https://app.test' })
    expect(await cache.get(KEY)).toBeUndefined()
    await cache.put(KEY, bytes(31, 139, 8, 0, 7))
    expect([...((await cache.get(KEY)) as Uint8Array)]).toEqual([31, 139, 8, 0, 7])
    expect([...(stores.get(BRANDED_CACHE_NAME) as Map<string, Response>).keys()]).toContain('https://app.test/__branded/fp1/branded-p00-145802fbd397.bin/120-48')
  })

  it('keeps at most `max` shards and drops the least recently used first', async () => {
    const { stores, storage } = fakeStorage()
    const cache = createShardCache({ storage, origin: 'https://app.test', max: 3 })
    for (const n of [1, 2, 3]) await cache.put(`p.bin:${n}:1`, bytes(n))
    await cache.get('p.bin:1:1') // 1 is now the freshest, 2 the oldest
    await cache.put('p.bin:4:1', bytes(4))
    expect(await cache.get('p.bin:2:1')).toBeUndefined()
    for (const n of [1, 3, 4]) expect(await cache.get(`p.bin:${n}:1`)).toBeDefined()
    const urls = [...(stores.get(BRANDED_CACHE_NAME) as Map<string, Response>).keys()].filter((url) => !url.endsWith('index.json'))
    expect(urls).toHaveLength(3)
  })

  it('holds the default of 300 shards', async () => {
    const { stores, storage } = fakeStorage()
    const cache = createShardCache({ storage, origin: 'https://app.test' })
    for (let n = 0; n < 305; n += 1) await cache.put(`p.bin:${n}:1`, bytes(1))
    const urls = [...(stores.get(BRANDED_CACHE_NAME) as Map<string, Response>).keys()].filter((url) => !url.endsWith('index.json'))
    expect(urls).toHaveLength(300)
    expect(await cache.get('p.bin:0:1')).toBeUndefined()
    expect(await cache.get('p.bin:304:1')).toBeDefined()
  })

  it('keeps the order across page loads (a new instance reads the stored index)', async () => {
    const { storage } = fakeStorage()
    const first = createShardCache({ storage, origin: 'https://app.test', max: 2 })
    await first.put('p.bin:1:1', bytes(1))
    await first.put('p.bin:2:1', bytes(2))
    const second = createShardCache({ storage, origin: 'https://app.test', max: 2 })
    await second.put('p.bin:3:1', bytes(3))
    expect(await second.get('p.bin:1:1')).toBeUndefined()
    expect(await second.get('p.bin:2:1')).toBeDefined()
  })

  it('rebuilds the order from the entries when the index is missing', async () => {
    const { stores, storage } = fakeStorage()
    const first = createShardCache({ storage, origin: 'https://app.test', max: 2 })
    await first.put('p.bin:1:1', bytes(1))
    await first.put('p.bin:2:1', bytes(2))
    ;(stores.get(BRANDED_CACHE_NAME) as Map<string, Response>).delete('https://app.test/__branded/index.json')
    const second = createShardCache({ storage, origin: 'https://app.test', max: 2 })
    await second.put('p.bin:3:1', bytes(3))
    const urls = [...(stores.get(BRANDED_CACHE_NAME) as Map<string, Response>).keys()].filter((url) => !url.endsWith('index.json'))
    expect(urls).toHaveLength(2)
    expect(await second.get('p.bin:3:1')).toBeDefined()
  })

  it('never throws: a failing cache just misses', async () => {
    const broken = { open: async () => { throw new Error('quota') } } as unknown as Pick<CacheStorage, 'open'>
    const cache = createShardCache({ storage: broken, origin: 'https://app.test' })
    await expect(cache.put(KEY, bytes(1))).resolves.toBeUndefined()
    await expect(cache.get(KEY)).resolves.toBeUndefined()
  })

  it('stores nothing, quietly, in a browser with no Cache API', async () => {
    const cache = createShardCache({ storage: undefined, origin: 'https://app.test' })
    await cache.put(KEY, bytes(1))
    expect(await cache.get(KEY)).toBeUndefined()
  })
})

describe('fingerprint keying', () => {
  it('derives the fingerprint from the packs and the format version', () => {
    const a = manifestFingerprint({ version: 2, packs: [['p0-aaa.bin', 10], ['p1-bbb.bin', 20]] })
    expect(a).toMatch(/^[0-9a-f]{12}$/)
    expect(manifestFingerprint({ version: 2, packs: [['p0-aaa.bin', 10], ['p1-bbb.bin', 20]] })).toBe(a)
    expect(manifestFingerprint({ version: 2, packs: [['p0-ccc.bin', 10], ['p1-bbb.bin', 20]] })).not.toBe(a)
    expect(manifestFingerprint({ version: 3, packs: [['p0-aaa.bin', 10], ['p1-bbb.bin', 20]] })).not.toBe(a)
  })

  it('never reads a shard cached under another fingerprint, and deletes those on first use', async () => {
    const { stores, storage } = fakeStorage()
    const old = createShardCache({ storage, origin: 'https://app.test', scope: async () => 'old' })
    await old.put('p.bin:1:1', bytes(1))
    const fresh = createShardCache({ storage, origin: 'https://app.test', scope: async () => 'new' })
    expect(await fresh.get('p.bin:1:1')).toBeUndefined()
    await fresh.put('p.bin:2:1', bytes(2))
    const urls = [...(stores.get(BRANDED_CACHE_NAME) as Map<string, Response>).keys()].filter((url) => !url.endsWith('index.json'))
    expect(urls).toEqual(['https://app.test/__branded/new/p.bin/2-1'])
  })

  it('stores and finds nothing while the manifest is unavailable', async () => {
    const { stores, storage } = fakeStorage()
    const cache = createShardCache({ storage, origin: 'https://app.test', scope: async () => undefined })
    await cache.put('p.bin:1:1', bytes(1))
    expect(await cache.get('p.bin:1:1')).toBeUndefined()
    expect(stores.size).toBe(0)
  })
})

describe('two tabs (review L2)', () => {
  it('share one cache without leaving orphans past the limit, and the index matches the shards', async () => {
    const { stores, storage } = fakeStorage()
    const tabA = createShardCache({ storage, origin: 'https://app.test', max: 4, scope: async () => 'fp1' })
    const tabB = createShardCache({ storage, origin: 'https://app.test', max: 4, scope: async () => 'fp1' })
    await tabA.put('p.bin:1:1', bytes(1))
    await tabB.put('p.bin:2:1', bytes(2))
    await tabA.put('p.bin:3:1', bytes(3))
    await tabB.put('p.bin:4:1', bytes(4))
    await tabA.put('p.bin:5:1', bytes(5))
    await tabB.put('p.bin:6:1', bytes(6))
    const cache = stores.get(BRANDED_CACHE_NAME) as Map<string, Response>
    const shards = [...cache.keys()].filter((url) => !url.endsWith('index.json')).sort()
    expect(shards).toHaveLength(4)
    const index = (await (cache.get('https://app.test/__branded/index.json') as Response).clone().json()) as string[]
    expect([...index].sort()).toEqual(shards.map((url) => new URL(url).pathname))
  })

  it('a new fingerprint deletes every shard under another one, including ones the index never listed', async () => {
    const { stores, storage } = fakeStorage()
    const old = createShardCache({ storage, origin: 'https://app.test', scope: async () => 'old' })
    await old.put('p.bin:1:1', bytes(1))
    const cache = stores.get(BRANDED_CACHE_NAME) as Map<string, Response>
    cache.set('https://app.test/__branded/older/p.bin/9-9', new Response(bytes(9)))
    const fresh = createShardCache({ storage, origin: 'https://app.test', scope: async () => 'new' })
    await fresh.put('p.bin:2:1', bytes(2))
    expect([...cache.keys()].filter((url) => !url.endsWith('index.json'))).toEqual(['https://app.test/__branded/new/p.bin/2-1'])
  })
})
