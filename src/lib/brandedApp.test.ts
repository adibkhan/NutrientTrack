import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ client: { searchBranded: vi.fn(), lookupBarcode: vi.fn(), getProduct: vi.fn(), loadManifest: vi.fn(), warm: vi.fn() }, options: [] as unknown[] }))
vi.mock('../catalog/branded', async (importOriginal) => ({ ...(await importOriginal<typeof import('../catalog/branded')>()), createBrandedClient: (options: unknown) => { hoisted.options.push(options); return hoisted.client } }))

import { manifestFingerprint } from './brandedCache'
import { findBarcode, isUnreachable, loadBrandedProduct, NO_RANGE_KEY, searchBrands, warmBrands } from './brandedApp'

describe('brandedApp', () => {
  it('creates one client, with the persistent shard cache behind it', async () => {
    hoisted.client.searchBranded.mockResolvedValue([])
    await searchBrands('oreo')
    await searchBrands('oreo')
    expect(hoisted.options).toHaveLength(1)
    expect(typeof (hoisted.options[0] as { shardCache: { get: unknown } }).shardCache.get).toBe('function')
    expect(hoisted.client.searchBranded).toHaveBeenCalledWith('oreo', expect.objectContaining({ latestOnly: true }))
  })

  it('passes the signal and the limit, and reports the reason the library gave', async () => {
    const controller = new AbortController()
    hoisted.client.searchBranded.mockImplementation(async (_query: string, options: { onReason: (reason: string) => void }) => { options.onReason('timeout'); return [] })
    const result = await searchBrands('oreo', { signal: controller.signal, limit: 12 })
    expect(result).toEqual({ rows: [], reason: 'timeout' })
    expect(hoisted.client.searchBranded).toHaveBeenLastCalledWith('oreo', expect.objectContaining({ signal: controller.signal, limit: 12 }))
  })

  it('never throws, whatever the client does', async () => {
    hoisted.client.searchBranded.mockRejectedValue(new Error('boom'))
    hoisted.client.lookupBarcode.mockRejectedValue(new Error('boom'))
    hoisted.client.getProduct.mockRejectedValue(new Error('boom'))
    expect(await searchBrands('x')).toEqual({ rows: [], reason: 'offline' })
    expect(await findBarcode('012345678905')).toEqual({ reason: 'offline' })
    expect(await loadBrandedProduct('00012345678905')).toEqual({ reason: 'offline' })
  })

  it('tells connection failures from a plain miss', () => {
    for (const reason of ['offline', 'timeout', 'bad-manifest', 'bad-response', 'bad-shard', 'range-unsupported'] as const) expect(isUnreachable(reason)).toBe(true)
    for (const reason of ['not-found', 'aborted', 'stale', 'bad-code', 'empty-query', undefined] as const) expect(isUnreachable(reason)).toBe(false)
  })

  it('review L13: a connection that cannot do Range is remembered for a day per manifest, so the probe is not repeated', async () => {
    const manifest = { version: 2, packs: [['a.bin', 10]] as Array<[string, number]> }
    hoisted.client.loadManifest.mockResolvedValue(manifest)
    hoisted.client.searchBranded.mockReset()
    hoisted.client.searchBranded.mockImplementation(async (_query: string, options: { onReason: (reason: string) => void }) => { options.onReason('range-unsupported'); return [] })
    localStorage.removeItem(NO_RANGE_KEY)
    expect((await searchBrands('oreo')).reason).toBe('range-unsupported')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(JSON.parse(localStorage.getItem(NO_RANGE_KEY) as string).fp).toBe(manifestFingerprint(manifest))
    hoisted.client.searchBranded.mockClear()
    expect(await searchBrands('oreo')).toEqual({ rows: [], reason: 'range-unsupported' })
    expect(await findBarcode('012345678905')).toEqual({ reason: 'range-unsupported' })
    expect(hoisted.client.searchBranded).not.toHaveBeenCalled()
    // A new build of the packs (another fingerprint) is probed again.
    hoisted.client.loadManifest.mockResolvedValue({ version: 2, packs: [['b.bin', 10]] })
    hoisted.client.searchBranded.mockResolvedValue([])
    await searchBrands('oreo')
    expect(hoisted.client.searchBranded).toHaveBeenCalled()
    expect(localStorage.getItem(NO_RANGE_KEY)).toBeNull()
    // A verdict older than a day is forgotten.
    localStorage.setItem(NO_RANGE_KEY, JSON.stringify({ fp: manifestFingerprint({ version: 2, packs: [['b.bin', 10]] }), at: Date.now() - 25 * 3600 * 1000 }))
    hoisted.client.searchBranded.mockClear()
    await searchBrands('oreo')
    expect(hoisted.client.searchBranded).toHaveBeenCalled()
    localStorage.removeItem(NO_RANGE_KEY)
  })

  it('review M6: warmBrands starts the background load once and never throws', () => {
    localStorage.removeItem(NO_RANGE_KEY)
    hoisted.client.warm.mockClear()
    warmBrands()
    expect(hoisted.client.warm).toHaveBeenCalledTimes(1)
    hoisted.client.warm.mockImplementation(() => { throw new Error('boom') })
    expect(() => warmBrands()).not.toThrow()
  })
})
