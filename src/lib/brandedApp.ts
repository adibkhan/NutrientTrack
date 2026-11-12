import { createBrandedClient, type BrandedClient, type BrandedProduct, type BrandedReason, type BrandedSummary } from '../catalog/branded'
import { createShardCache, manifestFingerprint } from './brandedCache'

/**
 * The app's one door to the self-hosted branded index (src/catalog/branded.ts). The client is created on first use with the persistent
 * shard cache behind it, so a product searched or scanned once opens offline afterwards. Nothing here throws and nothing is fetched at
 * import: a failure comes back as an empty value plus the reason the library gave.
 */
let client: BrandedClient | undefined
const shared = (): BrandedClient => {
  if (!client) {
    // Shards are keyed by the manifest's fingerprint; the manifest is already loaded (or cached) by the time the client asks for a shard.
    const scope = async () => {
      try {
        const manifest = await client?.loadManifest()
        return manifest ? manifestFingerprint(manifest) : undefined
      } catch { return undefined }
    }
    client = createBrandedClient({ shardCache: createShardCache({ scope }) })
  }
  return client
}

/** Failures that mean "the index could not be reached" (shown as a connection note), as opposed to "nothing matched". */
export const isUnreachable = (reason: BrandedReason | undefined): boolean =>
  reason === 'offline' || reason === 'timeout' || reason === 'bad-manifest' || reason === 'bad-response' || reason === 'bad-shard' || reason === 'range-unsupported'

// A server that ignores Range costs one aborted probe, then nothing for a day: the verdict is kept per manifest fingerprint.
export const NO_RANGE_KEY = 'nutrienttrack:branded-norange'
export const NO_RANGE_MS = 24 * 60 * 60 * 1000
const readNoRange = (): { fp: string; at: number } | undefined => {
  try {
    const value = JSON.parse(localStorage.getItem(NO_RANGE_KEY) ?? 'null') as { fp?: unknown; at?: unknown } | null
    return value && typeof value.fp === 'string' && typeof value.at === 'number' ? { fp: value.fp, at: value.at } : undefined
  } catch { return undefined }
}
const rangeBlocked = async (): Promise<boolean> => {
  const flag = readNoRange()
  if (!flag) return false
  if (Date.now() - flag.at > NO_RANGE_MS) { try { localStorage.removeItem(NO_RANGE_KEY) } catch { /* private mode */ } return false }
  const manifest = await shared().loadManifest()
  if (manifest && manifestFingerprint(manifest) === flag.fp) return true
  if (manifest) { try { localStorage.removeItem(NO_RANGE_KEY) } catch { /* private mode */ } }
  return false
}
const rememberNoRange = async (reason: BrandedReason | undefined): Promise<void> => {
  if (reason !== 'range-unsupported') return
  try {
    const manifest = await shared().loadManifest()
    if (manifest) localStorage.setItem(NO_RANGE_KEY, JSON.stringify({ fp: manifestFingerprint(manifest), at: Date.now() }))
  } catch { /* private mode */ }
}

/** Start loading the manifest and the popularity list in the background (when the logger opens). Never throws. */
export const warmBrands = (): void => {
  if (readNoRange()) return
  try { void shared().warm() } catch { /* nothing to warm */ }
}

export interface BrandedSearchResult { rows: BrandedSummary[]; reason?: BrandedReason }
export interface BrandedProductResult { product?: BrandedProduct; reason?: BrandedReason }

export const searchBrands = async (query: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<BrandedSearchResult> => {
  let reason: BrandedReason | undefined
  try {
    if (await rangeBlocked()) return { rows: [], reason: 'range-unsupported' }
    const rows = await shared().searchBranded(query, { limit: options.limit ?? 30, signal: options.signal, latestOnly: true, onReason: (value) => { reason = value } })
    void rememberNoRange(reason)
    return { rows, ...(reason ? { reason } : {}) }
  } catch {
    return { rows: [], reason: 'offline' }
  }
}

/** The product behind a typed or scanned code, from the self-hosted index only (no third party, no opt-in). */
export const findBarcode = async (code: string, options: { signal?: AbortSignal } = {}): Promise<BrandedProductResult> => {
  let reason: BrandedReason | undefined
  try {
    if (await rangeBlocked()) return { reason: 'range-unsupported' }
    const product = await shared().lookupBarcode(code, { signal: options.signal, onReason: (value) => { reason = value } })
    void rememberNoRange(reason)
    return { ...(product ? { product } : {}), ...(reason ? { reason } : {}) }
  } catch {
    return { reason: 'offline' }
  }
}

/** The full record of a search row. */
export const loadBrandedProduct = async (gtin: string, options: { signal?: AbortSignal } = {}): Promise<BrandedProductResult> => {
  let reason: BrandedReason | undefined
  try {
    if (await rangeBlocked()) return { reason: 'range-unsupported' }
    const product = await shared().getProduct(gtin, { signal: options.signal, onReason: (value) => { reason = value } })
    void rememberNoRange(reason)
    return { ...(product ? { product } : {}), ...(reason ? { reason } : {}) }
  } catch {
    return { reason: 'offline' }
  }
}
