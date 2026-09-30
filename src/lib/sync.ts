// Cloud sync: push this device's pending changes, then pull everything the cloud has changed since the last pull.
// The browser stays the primary copy. The cloud (public.sync_records) keeps the newest change per record.
import {
  acknowledgeChanges, applyRemoteChanges, getMeta, getPendingChanges, queueAllRecords, readChangedRecords, setMeta,
  type RemoteChange,
} from './db'

export interface OutgoingChange {
  store: RemoteChange['store']
  id: string
  data: Record<string, unknown> | null
  deleted: boolean
  client_updated_at: string
}

/** The server side of sync. The real one is Supabase; tests use an in-memory stand-in. */
export interface SyncBackend {
  /** Upsert changes. The server keeps whichever change has the later client_updated_at. */
  push(changes: OutgoingChange[]): Promise<void>
  /** Changes with server_updated_at after `since` (all when undefined), oldest first. */
  pull(since: string | undefined, limit: number): Promise<RemoteChange[]>
}

export interface SyncResult {
  pushed: number
  /** Local records created, changed or deleted by the pull. */
  applied: number
}

const PUSH_BATCH = 200
const PULL_PAGE = 500
/** Re-read a short window before the cursor: a change committed slightly out of order is still picked up. */
const PULL_OVERLAP_MS = 10_000

// Postgres returns microseconds; Date parses milliseconds reliably.
const toTime = (timestamp: string) => new Date(timestamp.replace(/(\.\d{3})\d+/, '$1')).getTime()

export const syncOnce = async (backend: SyncBackend, userId: string): Promise<SyncResult> => {
  // First sync of this device for this account: include everything logged before sync was on.
  if ((await getMeta<string>('syncUserId')) !== userId) {
    await queueAllRecords()
    await setMeta('pullCursor', undefined)
    await setMeta('syncUserId', userId)
  }

  let pushed = 0
  const pending = await getPendingChanges()
  for (let start = 0; start < pending.length; start += PUSH_BATCH) {
    const batch = pending.slice(start, start + PUSH_BATCH)
    const records = await readChangedRecords(batch)
    await backend.push(batch.map((change, index) => {
      const record = records[index]
      const deleted = change.deleted || !record
      return { store: change.store, id: change.id, data: deleted ? null : record ?? null, deleted, client_updated_at: change.clientUpdatedAt }
    }))
    await acknowledgeChanges(batch)
    pushed += batch.length
  }

  let applied = 0
  const cursor = await getMeta<string>('pullCursor')
  let since = cursor ? new Date(toTime(cursor) - PULL_OVERLAP_MS).toISOString() : undefined
  let latest = cursor
  for (;;) {
    const page = await backend.pull(since, PULL_PAGE)
    if (page.length === 0) break
    applied += await applyRemoteChanges(page)
    since = page[page.length - 1].server_updated_at
    if (!latest || toTime(since) > toTime(latest)) latest = since
    if (page.length < PULL_PAGE) break
  }
  if (latest !== cursor) await setMeta('pullCursor', latest)

  return { pushed, applied }
}
