import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  mightBeSignedIn: vi.fn(() => false),
  getCloudClient: vi.fn(),
  createSupabaseBackend: vi.fn(() => ({ push: vi.fn(), pull: vi.fn() })),
  sendSignInLink: vi.fn(async (_email: string) => undefined),
  signInLinkError: vi.fn((): string | undefined => undefined),
  signOutCloud: vi.fn(async () => undefined),
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
  sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0 })
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
    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 3 })
    const onRemoteChanges = vi.fn()
    const { result } = renderHook(() => useCloudSync(onRemoteChanges, vi.fn()))
    await flush()
    expect(sync.syncOnce).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(onRemoteChanges).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ status: 'synced', email: 'me@example.com' })

    sync.syncOnce.mockResolvedValue({ pushed: 1, applied: 0 })
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
      releases.push(() => { active -= 1; resolve({ pushed: 0, applied: 0 }) })
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

    sync.syncOnce.mockResolvedValue({ pushed: 0, applied: 0 })
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
})
