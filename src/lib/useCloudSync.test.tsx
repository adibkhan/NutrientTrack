import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  mightBeSignedIn: vi.fn(() => false),
  getCloudClient: vi.fn(),
  createSupabaseBackend: vi.fn(() => ({ push: vi.fn(), pull: vi.fn() })),
  sendSignInLink: vi.fn(async (_email: string) => undefined),
  signInLinkError: vi.fn((): string | undefined => undefined),
  signOutCloud: vi.fn(async () => undefined),
  deleteCloudAccount: vi.fn(async () => undefined),
}))
const sync = vi.hoisted(() => ({ syncOnce: vi.fn() }))
const db = vi.hoisted(() => ({ listeners: new Set<() => void>() }))
vi.mock('./cloud', () => cloud)
vi.mock('./sync', () => sync)
vi.mock('./db', () => ({
  onLocalChange: (listener: () => void) => { db.listeners.add(listener); return () => db.listeners.delete(listener) },
}))

import { useCloudSync } from './useCloudSync'

const user = { id: 'user-1', email: 'me@example.com' }
const signedInClient = () => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user } as unknown } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  },
})
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const localEdit = () => act(() => { db.listeners.forEach((listener) => listener()) })
const setOnline = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true })

beforeEach(() => {
  vi.useFakeTimers()
  db.listeners.clear()
  cloud.mightBeSignedIn.mockReturnValue(false)
  cloud.getCloudClient.mockReset()
  cloud.signInLinkError.mockReturnValue(undefined)
  sync.syncOnce.mockReset()
  sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0, skipped: 0 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setOnline(true)
})

describe('useCloudSync', () => {
  it('loads nothing and never syncs for someone who has not signed in', async () => {
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    localEdit()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.status).toBe('off')
    expect(cloud.getCloudClient).not.toHaveBeenCalled()
    expect(sync.syncOnce).not.toHaveBeenCalled()
  })

  it('syncs on restoring a session and refreshes the screen only when the pull changed data', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 3, skipped: 0 })
    const onRemoteChanges = vi.fn()
    const { result } = renderHook(() => useCloudSync(onRemoteChanges, vi.fn()))
    await flush()
    expect(sync.syncOnce).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(onRemoteChanges).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ status: 'synced', email: 'me@example.com' })

    sync.syncOnce.mockResolvedValue({ pushed: 1, applied: 0, skipped: 0 })
    await act(async () => { await result.current.syncNow() })
    expect(sync.syncOnce).toHaveBeenCalledTimes(2)
    expect(onRemoteChanges).toHaveBeenCalledTimes(1)
  })

  it('stays off when the stored session is gone', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    const client = signedInClient()
    client.auth.getSession.mockResolvedValue({ data: { session: null } })
    cloud.getCloudClient.mockResolvedValue(client)
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(result.current.status).toBe('off')
    expect(sync.syncOnce).not.toHaveBeenCalled()
  })

  it('syncs once, two seconds after the last of a burst of local edits', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    sync.syncOnce.mockClear()

    localEdit()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    localEdit()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(sync.syncOnce).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)
  })

  it('never runs two syncs at once; a trigger during a sync runs exactly one more afterwards', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    sync.syncOnce.mockImplementation(() => new Promise((resolve) => {
      active += 1
      peak = Math.max(peak, active)
      releases.push(() => { active -= 1; resolve({ pushed: 0, applied: 0, skipped: 0 }) })
    }))
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)

    await act(async () => { void result.current.syncNow(); void result.current.syncNow() })
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)

    await act(async () => { releases[0](); await vi.advanceTimersByTimeAsync(0) })
    expect(sync.syncOnce).toHaveBeenCalledTimes(2)
    await act(async () => { releases[1](); await vi.advanceTimersByTimeAsync(0) })
    expect(sync.syncOnce).toHaveBeenCalledTimes(2)
    expect(peak).toBe(1)
    expect(result.current.status).toBe('synced')
  })

  it('reports a failed sync as an error with a message while online, then recovers', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(result.current.status).toBe('error')
    expect(result.current.message).toMatch(/saved on this device/)

    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0, skipped: 0 })
    await act(async () => { await result.current.syncNow() })
    expect(result.current.status).toBe('synced')
    expect(result.current.message).toBeUndefined()
  })

  it('reports offline when the sync fails without a connection', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockImplementation(async () => {
      setOnline(false)
      throw new Error('Failed to fetch')
    })
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(result.current.status).toBe('offline')
    expect(result.current.message).toBeTruthy()
  })

  it('does not call the server while the device is offline', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    setOnline(false)
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(sync.syncOnce).not.toHaveBeenCalled()
    expect(result.current.status).toBe('offline')
  })

  it('shows link-sent with the trimmed address, and a friendly error when sending fails', async () => {
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await act(async () => { await result.current.sendLink('  me@example.com ') })
    expect(cloud.sendSignInLink).toHaveBeenCalledWith('me@example.com')
    expect(result.current).toMatchObject({ status: 'link-sent', email: 'me@example.com' })

    cloud.sendSignInLink.mockRejectedValueOnce(new Error('email rate limit exceeded'))
    await act(async () => { await result.current.sendLink('me@example.com') })
    expect(result.current.status).toBe('off')
    expect(result.current.message).toMatch(/too many/i)
    expect(cloud.getCloudClient).not.toHaveBeenCalled()
  })

  it('signs out: status off, and no more syncing on later edits', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    const announce = vi.fn()
    const { result } = renderHook(() => useCloudSync(vi.fn(), announce))
    await flush()
    sync.syncOnce.mockClear()
    await act(async () => { await result.current.signOut() })
    expect(cloud.signOutCloud).toHaveBeenCalled()
    expect(result.current.status).toBe('off')
    expect(announce).toHaveBeenCalled()
    localEdit()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(sync.syncOnce).not.toHaveBeenCalled()
  })

  it('waits for a sync already running before signing out, so it cannot re-apply the cloud copy after a clear', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    const events: string[] = []
    let release: () => void = () => undefined
    sync.syncOnce.mockImplementation(() => new Promise((resolve) => {
      release = () => { events.push('sync finished'); resolve({ pushed: 0, applied: 0, skipped: 0 }) }
    }))
    cloud.signOutCloud.mockImplementation(async () => { events.push('signOutCloud') })
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)

    let signedOut = false
    await act(async () => { void result.current.signOut().then(() => { signedOut = true }); await vi.advanceTimersByTimeAsync(0) })
    expect(cloud.signOutCloud).not.toHaveBeenCalled()
    expect(signedOut).toBe(false)

    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })
    expect(events).toEqual(['sync finished', 'signOutCloud'])
    expect(signedOut).toBe(true)
    expect(result.current.status).toBe('off')
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)
  })

  it('does not start a queued second sync once sign-out began during the first', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    let release: () => void = () => undefined
    sync.syncOnce.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ pushed: 0, applied: 0, skipped: 0 }) }))
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    await act(async () => { void result.current.syncNow() }) // queues a re-run
    await act(async () => { void result.current.signOut(); await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)
  })

  it('goes back from link-sent to off with resetLink', async () => {
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await act(async () => { await result.current.sendLink('me@example.com') })
    expect(result.current.status).toBe('link-sent')
    act(() => result.current.resetLink())
    expect(result.current.status).toBe('off')
  })

  it('says how many items stay on this device and announces it as an error when the sync skipped some', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockResolvedValue({ pushed: 3, applied: 0, skipped: 2 })
    const announce = vi.fn()
    const { result } = renderHook(() => useCloudSync(vi.fn(), announce))
    await flush()
    expect(result.current.status).toBe('synced')
    expect(result.current.message).toBe('2 items could not be backed up and stay on this device only.')
    expect(announce).toHaveBeenCalledWith('2 items could not be backed up and stay on this device only.', 'error')
  })

  it('uses the singular for one skipped item', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0, skipped: 1 })
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(result.current.message).toBe('1 item could not be backed up and stays on this device only.')
  })

  it('clears the skipped message and does not announce when a later sync skips nothing', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0, skipped: 1 })
    const announce = vi.fn()
    const { result } = renderHook(() => useCloudSync(vi.fn(), announce))
    await flush()
    expect(result.current.message).toBeTruthy()
    announce.mockClear()

    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0, skipped: 0 })
    await act(async () => { await result.current.syncNow() })
    expect(result.current.message).toBeUndefined()
    expect(announce).not.toHaveBeenCalled()
  })
})

describe('useCloudSync sign-out while something is in flight', () => {
  const pendingSession = () => {
    let resolve: (value: { data: { session: unknown } }) => void = () => undefined
    const promise = new Promise<{ data: { session: unknown } }>((r) => { resolve = r })
    const client = signedInClient()
    client.auth.getSession.mockReturnValue(promise)
    return { client, resolveWith: (session: unknown) => resolve({ data: { session } }) }
  }

  beforeEach(() => {
    cloud.signOutCloud.mockReset()
    cloud.signOutCloud.mockImplementation(async () => { cloud.mightBeSignedIn.mockReturnValue(false) })
    cloud.deleteCloudAccount.mockReset()
    cloud.deleteCloudAccount.mockImplementation(async () => { cloud.mightBeSignedIn.mockReturnValue(false) })
  })

  it('signs out after waiting five seconds when the running sync never settles', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockImplementation(() => new Promise(() => undefined))
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)

    let signedOut = false
    await act(async () => { void result.current.signOut().then(() => { signedOut = true }); await vi.advanceTimersByTimeAsync(4999) })
    expect(cloud.signOutCloud).not.toHaveBeenCalled()
    expect(signedOut).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(cloud.signOutCloud).toHaveBeenCalledTimes(1)
    expect(signedOut).toBe(true)
    expect(result.current.status).toBe('off')
  })

  const stallThenSignOut = async (onRemoteChanges = vi.fn()) => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    let settle: { resolve: (value: { pushed: number; applied: number; skipped: number }) => void; reject: (error: Error) => void } = { resolve: () => undefined, reject: () => undefined }
    sync.syncOnce.mockImplementation(() => new Promise((resolve, reject) => { settle = { resolve, reject } }))
    const hook = renderHook(() => useCloudSync(onRemoteChanges, vi.fn()))
    await flush()
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)
    await act(async () => { void hook.result.current.signOut(); await vi.advanceTimersByTimeAsync(5000) })
    expect(hook.result.current.status).toBe('off')
    return { ...hook, settle: () => settle }
  }

  it('keeps the status off when a sync abandoned by sign-out fails later', async () => {
    const { result, settle } = await stallThenSignOut()
    await act(async () => { settle().reject(new Error('boom')); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('off')
    expect(result.current.message).toBeUndefined()
  })

  it('keeps the status off and records no sync time when a sync abandoned by sign-out succeeds later', async () => {
    const onRemoteChanges = vi.fn()
    const { result, settle } = await stallThenSignOut(onRemoteChanges)
    await act(async () => { settle().resolve({ pushed: 0, applied: 1, skipped: 2 }); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('off')
    expect(result.current.lastSyncedAt).toBeUndefined()
    expect(result.current.message).toBeUndefined()
  })

  it('ignores online and visibility triggers while sign-out waits for a stalled sync', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockImplementation(() => new Promise(() => undefined))
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    cloud.getCloudClient.mockClear()
    sync.syncOnce.mockClear()
    const client = signedInClient()
    cloud.getCloudClient.mockResolvedValue(client)

    await act(async () => { void result.current.signOut(); await vi.advanceTimersByTimeAsync(2000) })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      void result.current.syncNow()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(cloud.getCloudClient).not.toHaveBeenCalled()
    expect(client.auth.getSession).not.toHaveBeenCalled()
    expect(sync.syncOnce).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(cloud.signOutCloud).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('off')
    expect(sync.syncOnce).not.toHaveBeenCalled()
  })

  it('can sign in again after a completed sign-out, so the sign-out guard does not stay stuck', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    await act(async () => { await result.current.signOut() })
    expect(result.current.status).toBe('off')
    sync.syncOnce.mockClear()
    cloud.getCloudClient.mockClear()

    await act(async () => { await result.current.sendLink('me@example.com') })
    expect(result.current.status).toBe('link-sent')
    cloud.mightBeSignedIn.mockReturnValue(true) // the emailed link was followed and stored a session
    await act(async () => { await result.current.syncNow() })
    expect(cloud.getCloudClient).toHaveBeenCalled()
    expect(sync.syncOnce).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('synced')
  })

  it('does not wait the full five seconds when the running sync finishes after one second', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    cloud.getCloudClient.mockResolvedValue(signedInClient())
    sync.syncOnce.mockImplementation(() => new Promise((resolve) => { setTimeout(() => resolve({ pushed: 0, applied: 0, skipped: 0 }), 1000) }))
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()

    await act(async () => { void result.current.signOut(); await vi.advanceTimersByTimeAsync(999) })
    expect(cloud.signOutCloud).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(cloud.signOutCloud).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('off')
  })

  it('does not sign the device back in when sign-out happens while the session is still being restored', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    const { client, resolveWith } = pendingSession()
    cloud.getCloudClient.mockResolvedValue(client)
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()
    expect(client.auth.getSession).toHaveBeenCalledTimes(1)

    await act(async () => { await result.current.signOut() })
    await act(async () => { resolveWith({ user }); await vi.advanceTimersByTimeAsync(0) })

    expect(sync.syncOnce).not.toHaveBeenCalled()
    expect(client.auth.onAuthStateChange).not.toHaveBeenCalled()
    expect(result.current.status).toBe('off')
    await act(async () => { await result.current.syncNow() })
    expect(sync.syncOnce).not.toHaveBeenCalled()
    expect(result.current.status).toBe('off')
  })

  it('does not sign the device back in when the account is deleted while the session is still being restored', async () => {
    cloud.mightBeSignedIn.mockReturnValue(true)
    const { client, resolveWith } = pendingSession()
    cloud.getCloudClient.mockResolvedValue(client)
    const { result } = renderHook(() => useCloudSync(vi.fn(), vi.fn()))
    await flush()

    await act(async () => { await result.current.deleteAccount() })
    expect(cloud.deleteCloudAccount).toHaveBeenCalledTimes(1)
    await act(async () => { resolveWith({ user }); await vi.advanceTimersByTimeAsync(0) })

    expect(sync.syncOnce).not.toHaveBeenCalled()
    expect(client.auth.onAuthStateChange).not.toHaveBeenCalled()
    expect(result.current.status).toBe('off')
  })
})
