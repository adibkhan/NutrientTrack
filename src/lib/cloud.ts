// Supabase connection for opt-in backup and sync. The Supabase library is loaded only when needed,
// so people who never turn sync on download nothing extra and the app stays fully offline.
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { setMeta } from './db'
import { RejectedRecordError, type OutgoingChange, type SyncBackend } from './sync'
import type { RemoteChange } from './db'

const SUPABASE_URL = 'https://ithvjtxemjtkdwxaovfq.supabase.co'
/** Publishable key: designed to be public. Row level security on sync_records limits every user to their own rows. */
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0Dwm1En4zrIH_INp2vqMPQ_uACIQPu4'
/** Where supabase-js keeps the session. Another tab writing it means someone signed in there. */
export const SESSION_STORAGE_KEY = 'sb-ithvjtxemjtkdwxaovfq-auth-token'

let clientPromise: Promise<SupabaseClient> | null = null

export const getCloudClient = (): Promise<SupabaseClient> => {
  clientPromise ??= import('@supabase/supabase-js')
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // Implicit flow: the emailed link carries the session, so it works even when opened in a different browser tab.
      auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }))
    .catch((error: unknown) => {
      clientPromise = null // e.g. offline before the library was ever downloaded: allow a later retry
      throw error
    })
  return clientPromise
}

/** Whether this browser holds a sign-in session. Works without loading Supabase. */
export const hasStoredSession = (): boolean => {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/** Cheap check that avoids loading Supabase for people who have never signed in. */
export const mightBeSignedIn = (): boolean => {
  try {
    if (/access_token=|error_description=/.test(window.location.hash)) return true
  } catch {
    return false
  }
  return hasStoredSession()
}

/** A sign-in problem reported by the emailed link (e.g. it expired), taken from the page address. */
export const signInLinkError = (): string | undefined => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('error_description')?.replace(/\+/g, ' ') ?? undefined
}

export const sendSignInLink = async (email: string): Promise<void> => {
  const client = await getCloudClient()
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true } })
  if (error) throw error
}

export const getCloudUser = async (): Promise<User | null> => {
  if (!mightBeSignedIn()) return null
  const client = await getCloudClient()
  const { data } = await client.auth.getSession()
  return data.session?.user ?? null
}

/**
 * Sign out on this device only. Local data stays; the next sign-in merges it into that account.
 * Works offline and even when the Supabase library could not be downloaded: the stored session is removed directly.
 */
export const signOutCloud = async (): Promise<void> => {
  try {
    const client = await getCloudClient()
    await client.auth.signOut({ scope: 'local' })
  } catch {
    // The library is unavailable (e.g. offline right after an update); the stored session is dropped below.
  } finally {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // Storage is unavailable; there is no stored session to remove.
    }
  }
  await setMeta('syncUserId', undefined)
  await setMeta('pullCursor', undefined)
}

/** Delete the signed-in user's cloud account and every synced record, then sign out here. Local data stays. */
export const deleteCloudAccount = async (): Promise<void> => {
  const client = await getCloudClient()
  const { error } = await client.rpc('delete_my_account')
  if (error) throw error
  await signOutCloud()
}

export const createSupabaseBackend = (client: SupabaseClient): SyncBackend => ({
  async push(changes: OutgoingChange[]) {
    const { error } = await client.from('sync_records').upsert(changes, { onConflict: 'user_id,store,id' })
    // SQLSTATE classes 22 (data exception) and 23 (constraint violation): this record will never be accepted.
    if (error && /^(22|23)/.test(error.code ?? '')) throw new RejectedRecordError(error.message)
    if (error) throw error
  },
  async pull(since: string | undefined, limit: number) {
    let query = client
      .from('sync_records')
      .select('store,id,data,deleted,client_updated_at,server_updated_at')
      .order('server_updated_at', { ascending: true })
      .limit(limit)
    if (since) query = query.gt('server_updated_at', since)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as RemoteChange[]
  },
})
