import type { ShardCache } from '../catalog/branded'

/**
 * Where fetched branded shards are kept for offline reuse. The cache is named and never touched by the service worker's shell cleanup
 * (public/sw.js keeps every cache with this prefix), so an app update does not throw them away. Keys are synthetic same-origin URLs,
 * /__branded/<fingerprint>/<pack file>/<offset>-<length>, holding the shard's gzipped bytes exactly as fetched. The fingerprint comes
 * from the manifest (see manifestFingerprint), so shards of an older build of the packs are never read against a newer manifest, and
 * the first use under a new fingerprint deletes the old ones. A small index (the keys, oldest first)
 * sits in the same cache and bounds it: past BRANDED_CACHE_MAX shards the least recently used go.
 */
export const BRANDED_CACHE_NAME = 'nutrienttrack-branded-v1'
export const BRANDED_CACHE_PREFIX = 'nutrienttrack-branded-'
/** About 300 shards, roughly 10 MB. */
export const BRANDED_CACHE_MAX = 300
const INDEX_PATH = '/__branded/index.json'

/** A short stable fingerprint of a manifest's packs (their names carry content hashes) and format version. */
export const manifestFingerprint = (manifest: { version?: number; packs?: Array<[string, number]> }): string => {
  const text = `${manifest.version ?? 0}|${(manifest.packs ?? []).map((pack) => `${pack[0]}:${pack[1]}`).join('|')}`
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < text.length; index += 1) {
    a = Math.imul(a ^ text.charCodeAt(index), 0x01000193) >>> 0
    b = Math.imul(b + text.charCodeAt(index), 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`.slice(0, 12)
}

/** The client's key "<pack file>:<offset>:<length>" as a path under a fingerprint. */
export const shardPath = (key: string, scope: string): string => {
  const [pack, offset, length] = key.split(':')
  return `/__branded/${scope}/${pack}/${offset}-${length}`
}

export interface ShardCacheOptions {
  storage?: Pick<CacheStorage, 'open'>
  max?: number
  origin?: string
  /** The manifest fingerprint to key entries by; undefined (manifest not available) means "store and find nothing". */
  scope: () => Promise<string | undefined>
}

/** A ShardCache backed by the Cache API, or one that stores nothing when the browser has none. Every failure is swallowed: the cache is an extra. */
export const createShardCache = (options: ShardCacheOptions): ShardCache => {
  const storage = options.storage ?? (typeof caches !== 'undefined' ? caches : undefined)
  const max = options.max ?? BRANDED_CACHE_MAX
  if (!storage) return { get: () => undefined, put: () => undefined }
  const origin = options.origin ?? (typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : 'http://localhost')
  const urlFor = (path: string) => new URL(path, origin).href
  let order: string[] | undefined
  let orderScope: string | undefined
  let chain: Promise<unknown> = Promise.resolve()
  // One operation at a time, so the index and the entries never disagree.
  const queue = <T>(work: () => Promise<T>): Promise<T | undefined> => {
    const next = chain.then(work, work)
    chain = next.catch(() => undefined)
    return next.catch(() => undefined)
  }

  const shardKeys = async (cache: Cache): Promise<string[]> => {
    const paths: string[] = []
    for (const request of await cache.keys()) {
      let path: string
      try { path = new URL(request.url).pathname } catch { continue }
      if (path.startsWith('/__branded/') && path !== INDEX_PATH) paths.push(path)
    }
    return paths
  }

  /**
   * The order of the shards of the current fingerprint, reconciled with what the cache really holds: entries of any other fingerprint
   * are deleted by prefix, index entries without a shard are dropped, and shards the index does not know (another tab wrote them) are
   * kept, newest, so they count toward the limit and can be evicted. Two tabs therefore never leave orphans behind.
   */
  const reconcile = async (cache: Cache, scope: string): Promise<string[]> => {
    let stored: string[] = []
    try {
      const response = await cache.match(urlFor(INDEX_PATH))
      const parsed: unknown = response ? await response.json() : undefined
      if (Array.isArray(parsed)) stored = parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      // Rebuilt from the entries themselves.
    }
    const prefix = `/__branded/${scope}/`
    const keys = await shardKeys(cache)
    for (const path of keys) if (!path.startsWith(prefix)) await cache.delete(urlFor(path))
    const live = new Set(keys.filter((path) => path.startsWith(prefix)))
    const known = stored.filter((path) => live.has(path))
    const unknown = [...live].filter((path) => !known.includes(path))
    return [...known, ...unknown]
  }

  /** The order under the current fingerprint, reconciled the first time (and whenever the fingerprint changes). */
  const loadOrder = async (cache: Cache, scope: string): Promise<string[]> => {
    if (order && orderScope === scope) return order
    order = await reconcile(cache, scope)
    orderScope = scope
    await saveOrder(cache, order)
    return order
  }
  const saveOrder = async (cache: Cache, list: string[]) => {
    await cache.put(urlFor(INDEX_PATH), new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } }))
  }

  return {
    get: (key) => queue(async () => {
      const scope = await options.scope()
      if (!scope) return undefined
      const cache = await storage.open(BRANDED_CACHE_NAME)
      const list = await loadOrder(cache, scope)
      const path = shardPath(key, scope)
      const hit = await cache.match(urlFor(path))
      if (!hit) return undefined
      const bytes = new Uint8Array(await hit.arrayBuffer())
      // Most recently used goes last.
      if (list[list.length - 1] !== path) {
        order = [...list.filter((item) => item !== path), path]
        await saveOrder(cache, order)
      }
      return bytes
    }),
    put: async (key, bytes) => {
      await queue(async () => {
        const scope = await options.scope()
        if (!scope) return
        const cache = await storage.open(BRANDED_CACHE_NAME)
        await loadOrder(cache, scope)
        const list = await reconcile(cache, scope)
        const path = shardPath(key, scope)
        await cache.put(urlFor(path), new Response(bytes as BodyInit, { headers: { 'content-type': 'application/octet-stream' } }))
        const next = list.filter((item) => item !== path)
        next.push(path)
        while (next.length > max) {
          const oldest = next.shift() as string
          await cache.delete(urlFor(oldest))
        }
        order = next
        await saveOrder(cache, next)
      })
    },
  }
}
