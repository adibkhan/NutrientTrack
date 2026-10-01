// cloud.ts: sign-out that survives an unavailable Supabase library, the stored-session check, and how the real
// backend classifies push errors. The Supabase library and the database are the only things faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const db = vi.hoisted(() => ({ setMeta: vi.fn(async (_key: string, _value: unknown) => undefined) }))
vi.mock('@supabase/supabase-js', () => supabase)
vi.mock('./db', () => db)

type Cloud = typeof import('./cloud')
type Sync = typeof import('./sync')
const load = async (): Promise<{ cloud: Cloud; sync: Sync }> => ({ cloud: await import('./cloud'), sync: await import('./sync') })

const fakeClient = (upsertResult: unknown = { error: null }) => ({
  auth: { signOut: vi.fn(async () => ({ error: null })) },
  from: vi.fn(() => ({ upsert: vi.fn(async () => upsertResult) })),
})

beforeEach(() => {
  vi.resetModules()
  supabase.createClient.mockReset()
  db.setMeta.mockClear()
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

describe('hasStoredSession', () => {
  it('is false with nothing stored and true once the session key exists', async () => {
    const { cloud } = await load()
    expect(cloud.hasStoredSession()).toBe(false)
    localStorage.setItem(cloud.SESSION_STORAGE_KEY, '{}')
    expect(cloud.hasStoredSession()).toBe(true)
    expect(cloud.mightBeSignedIn()).toBe(true)
  })

  it('is false when storage cannot be read', async () => {
    const { cloud } = await load()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(cloud.hasStoredSession()).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('signOutCloud', () => {
  it('signs out locally only and clears the sync bookkeeping when the client works', async () => {
    const client = fakeClient()
    supabase.createClient.mockReturnValue(client)
    const { cloud } = await load()
    localStorage.setItem(cloud.SESSION_STORAGE_KEY, '{}')

    await cloud.signOutCloud()

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(db.setMeta).toHaveBeenCalledWith('syncUserId', undefined)
    expect(db.setMeta).toHaveBeenCalledWith('pullCursor', undefined)
  })

  it('still removes the stored session and clears both meta keys when the library cannot be loaded', async () => {
    supabase.createClient.mockImplementation(() => { throw new Error('Failed to fetch dynamically imported module') })
    const { cloud } = await load()
    localStorage.setItem(cloud.SESSION_STORAGE_KEY, '{}')

    await expect(cloud.signOutCloud()).resolves.toBeUndefined()

    expect(localStorage.getItem(cloud.SESSION_STORAGE_KEY)).toBeNull()
    expect(cloud.hasStoredSession()).toBe(false)
    expect(db.setMeta).toHaveBeenCalledWith('syncUserId', undefined)
    expect(db.setMeta).toHaveBeenCalledWith('pullCursor', undefined)
  })

  it('removes the stored session even when the library signOut call itself throws', async () => {
    const client = fakeClient()
    client.auth.signOut.mockRejectedValue(new Error('offline'))
    supabase.createClient.mockReturnValue(client)
    const { cloud } = await load()
    localStorage.setItem(cloud.SESSION_STORAGE_KEY, '{}')
    await expect(cloud.signOutCloud()).resolves.toBeUndefined()
    expect(localStorage.getItem(cloud.SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('getCloudClient', () => {
  it('retries the library load after an earlier attempt failed', async () => {
    supabase.createClient.mockImplementationOnce(() => { throw new Error('offline') })
    const client = fakeClient()
    supabase.createClient.mockReturnValueOnce(client)
    const { cloud } = await load()

    await expect(cloud.getCloudClient()).rejects.toThrow('offline')
    await expect(cloud.getCloudClient()).resolves.toBe(client)
    expect(supabase.createClient).toHaveBeenCalledTimes(2)
  })

  it('shares one client between calls once loaded', async () => {
    supabase.createClient.mockReturnValue(fakeClient())
    const { cloud } = await load()
    expect(await cloud.getCloudClient()).toBe(await cloud.getCloudClient())
    expect(supabase.createClient).toHaveBeenCalledTimes(1)
  })
})

describe('createSupabaseBackend push', () => {
  const row = { store: 'entries' as const, id: 'e1', data: { id: 'e1' }, deleted: false, client_updated_at: '2026-09-30T00:00:00.000Z' }
  const pushWith = async (result: unknown) => {
    const { cloud, sync } = await load()
    const backend = cloud.createSupabaseBackend(fakeClient(result) as never)
    return { run: () => backend.push([row]), Rejected: sync.RejectedRecordError }
  }

  it.each(['23514', '22007', '23505', '22001'])('maps Postgres error %s to RejectedRecordError', async (code) => {
    const { run, Rejected } = await pushWith({ error: Object.assign(new Error('bad row'), { code }) })
    await expect(run()).rejects.toBeInstanceOf(Rejected)
  })

  it.each([['42501'], [''], [undefined], ['08006'], ['PGRST301']])('keeps error code %j as a plain, retryable error', async (code) => {
    const { run, Rejected } = await pushWith({ error: Object.assign(new Error('nope'), { code }) })
    const error = await run().then(() => undefined, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(Rejected)
  })

  it('treats a network-style failure with no code as retryable', async () => {
    const { run, Rejected } = await pushWith({ error: Object.assign(new TypeError('Failed to fetch'), { code: undefined }) })
    const error = await run().then(() => undefined, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).not.toBeInstanceOf(Rejected)
  })

  it('resolves when there is no error', async () => {
    const { run } = await pushWith({ error: null })
    await expect(run()).resolves.toBeUndefined()
  })
})
