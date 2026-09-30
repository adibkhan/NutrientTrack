import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createSupabaseBackend, deleteCloudAccount, getCloudClient, mightBeSignedIn, sendSignInLink, SESSION_STORAGE_KEY, signInLinkError, signOutCloud } from './cloud'
import { onLocalChange } from './db'
import { syncOnce } from './sync'

export type CloudStatus = 'off' | 'checking' | 'link-sent' | 'syncing' | 'synced' | 'offline' | 'error'

export interface CloudSyncState {
  status: CloudStatus
  email?: string
  lastSyncedAt?: string
  message?: string
}

export const isSignedInStatus = (status: CloudStatus): boolean =>
  status === 'syncing' || status === 'synced' || status === 'offline' || status === 'error'

export interface CloudSync extends CloudSyncState {
  sendLink: (email: string) => Promise<void>
  syncNow: () => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
}

/** Wait after a local edit before syncing, so a burst of edits goes up together. */
const LOCAL_CHANGE_DELAY_MS = 2000

const friendlyAuthError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (/rate limit/i.test(message)) return 'Too many sign-in emails were sent recently. Try again in a little while.'
  if (/invalid.*email|email.*invalid/i.test(message)) return 'Check the email address and try again.'
  return 'The sign-in email could not be sent. Check your connection and try again.'
}

/**
 * Opt-in cloud backup and sync. Does nothing, and loads nothing, until someone signs in.
 * `onRemoteChanges` runs after a pull changed local data, so the screen can refresh.
 */
export const useCloudSync = (onRemoteChanges: () => void, announce: (message: string, tone?: 'success' | 'error') => void): CloudSync => {
  const [state, setState] = useState<CloudSyncState>(() => ({ status: mightBeSignedIn() ? 'checking' : 'off' }))
  const userRef = useRef<User | null>(null)
  const running = useRef(false)
  const runAgain = useRef(false)
  const connecting = useRef(false)
  const authUnsubscribe = useRef<(() => void) | null>(null)
  const mounted = useRef(true)
  const onRemoteChangesRef = useRef(onRemoteChanges)
  const announceRef = useRef(announce)
  onRemoteChangesRef.current = onRemoteChanges
  announceRef.current = announce

  const runSync = useCallback(async () => {
    const user = userRef.current
    if (!user) return
    if (running.current) {
      runAgain.current = true
      return
    }
    if (!navigator.onLine) {
      setState((current) => ({ ...current, status: 'offline' }))
      return
    }
    running.current = true
    setState((current) => ({ ...current, status: 'syncing' }))
    try {
      do {
        runAgain.current = false
        const result = await syncOnce(createSupabaseBackend(await getCloudClient()), user.id)
        if (result.applied > 0) onRemoteChangesRef.current()
      } while (runAgain.current && userRef.current)
      setState((current) => ({ ...current, status: 'synced', lastSyncedAt: new Date().toISOString(), message: undefined }))
    } catch {
      setState((current) => ({
        ...current,
        status: navigator.onLine ? 'error' : 'offline',
        message: 'Sync paused. Your changes are saved on this device and will sync when the connection works again.',
      }))
    } finally {
      running.current = false
    }
  }, [])

  /** Restore a session, or finish signing in from an emailed link. Safe to call again, e.g. after an offline start. */
  const connect = useCallback(async () => {
    if (!mightBeSignedIn() || connecting.current || userRef.current) return
    connecting.current = true
    // Read the link before supabase-js consumes it: it clears the address while restoring the session.
    const fromLink = /access_token=/.test(window.location.hash)
    const linkError = signInLinkError()
    try {
      const client = await getCloudClient()
      const { data } = await client.auth.getSession()
      if (!mounted.current) return
      if (fromLink || linkError || window.location.href.endsWith('#')) window.history.replaceState(null, '', window.location.pathname + window.location.search)
      if (linkError) announceRef.current(`That sign-in link didn't work: ${linkError}. Send a new one from Settings.`, 'error')
      userRef.current = data.session?.user ?? null
      if (!userRef.current) {
        setState({ status: 'off' })
        return
      }
      setState((current) => ({ ...current, status: 'syncing', email: userRef.current?.email ?? undefined, message: undefined }))
      if (fromLink) announceRef.current('Signed in. Backup and sync is on.')
      if (!authUnsubscribe.current) {
        const subscription = client.auth.onAuthStateChange((_event, session) => {
          userRef.current = session?.user ?? null
          if (!session) setState({ status: 'off' })
        })
        authUnsubscribe.current = () => subscription.data.subscription.unsubscribe()
      }
      void runSync()
    } catch {
      if (mounted.current) setState({ status: 'offline', message: 'Backup and sync will start when this device is online.' })
    } finally {
      connecting.current = false
    }
  }, [runSync])

  /** Sync if signed in; otherwise retry connecting when a session is expected (e.g. after starting offline). */
  const syncOrConnect = useCallback(async () => {
    if (userRef.current) await runSync()
    else await connect()
  }, [connect, runSync])

  useEffect(() => {
    mounted.current = true
    void connect()
    // A sign-in finished in another tab stores the session: pick it up here too.
    const fromOtherTab = (event: StorageEvent) => {
      if (event.key === SESSION_STORAGE_KEY && event.newValue) void connect()
    }
    window.addEventListener('storage', fromOtherTab)
    return () => {
      mounted.current = false
      window.removeEventListener('storage', fromOtherTab)
      authUnsubscribe.current?.()
      authUnsubscribe.current = null
    }
  }, [connect])

  // Sync after local edits, when the app comes back into view, and when the device reconnects.
  useEffect(() => {
    let timer: number | undefined
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void runSync() }, LOCAL_CHANGE_DELAY_MS)
    }
    const whenVisible = () => {
      if (document.visibilityState === 'visible') void syncOrConnect()
    }
    const now = () => { void syncOrConnect() }
    const unsubscribe = onLocalChange(soon)
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('online', now)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
      document.removeEventListener('visibilitychange', whenVisible)
      window.removeEventListener('online', now)
    }
  }, [runSync, syncOrConnect])

  const sendLink = useCallback(async (email: string) => {
    try {
      await sendSignInLink(email.trim())
      setState({ status: 'link-sent', email: email.trim() })
    } catch (error) {
      setState({ status: 'off', message: friendlyAuthError(error) })
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await signOutCloud()
    } finally {
      userRef.current = null
      setState({ status: 'off' })
      announceRef.current('Signed out. Your data is still on this device.')
    }
  }, [])

  const deleteAccount = useCallback(async () => {
    try {
      await deleteCloudAccount()
      userRef.current = null
      setState({ status: 'off' })
      announceRef.current('Your cloud account and its copy of your diary were deleted. Everything on this device is still here.')
    } catch {
      announceRef.current('Your cloud account could not be deleted. Check your connection and try again.', 'error')
    }
  }, [])

  return { ...state, sendLink, syncNow: syncOrConnect, signOut, deleteAccount }
}
