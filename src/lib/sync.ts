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

/** Thrown by a backend when the server will never accept a record (a check or data-type violation), as opposed to a
 *  network or sign-in problem that may pass later. That record is set aside so it cannot block every other one. */
export class RejectedRecordError extends Error {}

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
  /** Local records the server will not accept. They stay on this device only. */
  skipped: number
}

const PUSH_BATCH = 200
/** Limits mirrored from public.sync_records (id length 1 to 200, data at most 64 KB); anything over is never sent. */
const MAX_ID_LENGTH = 200
const MAX_DATA_BYTES = 60_000
const PULL_PAGE = 500
/** Re-read a short window before the cursor: a change committed slightly out of order is still picked up. */
const PULL_OVERLAP_MS = 10_000

// Postgres returns microseconds; Date parses milliseconds reliably.
const toTime = (timestamp: string) => new Date(timestamp.replace(/(\.\d{3})\d+/, '$1')).getTime()

const unsendable = (change: OutgoingChange): boolean =>
  change.id.length < 1 || change.id.length > MAX_ID_LENGTH ||
  (change.data !== null && new TextEncoder().encode(JSON.stringify(change.data)).length > MAX_DATA_BYTES)

/** Send one batch. If the server rejects it, retry row by row and set aside only the rows it will not accept. */
const pushBatch = async (backend: SyncBackend, rows: OutgoingChange[]): Promise<number> => {
  try {
    await backend.push(rows)
    return 0
  } catch (error) {
    if (!(error instanceof RejectedRecordError)) throw error
    if (rows.length === 1) return 1
  }
  let rejected = 0
  for (const row of rows) {
    try {
      await backend.push([row])
    } catch (error) {
      if (!(error instanceof RejectedRecordError)) throw error
      rejected += 1
    }
  }
  return rejected
}

export const syncOnce = async (backend: SyncBackend, userId: string): Promise<SyncResult> => {
  // First sync of this device for this account: include everything logged before sync was on.
  if ((await getMeta<string>('syncUserId')) !== userId) {
    await queueAllRecords()
    await setMeta('pullCursor', undefined)
    await setMeta('syncUserId', userId)
  }
  // From now on deletes must be queued too, even while signed out, so other devices learn about them.
  await setMeta('everSynced', true)

  // A failed push must not stop the pull: the newest cloud copies still need to arrive. The error is raised afterwards.
  let pushed = 0
  let skipped = 0
  let pushError: unknown
  try {
    const pending = await getPendingChanges()
    for (let start = 0; start < pending.length; start += PUSH_BATCH) {
      const batch = pending.slice(start, start + PUSH_BATCH)
      const records = await readChangedRecords(batch)
      const rows = batch.map((change, index): OutgoingChange => {
        const record = records[index]
        const deleted = change.deleted || !record
        // An unreadable change time must not poison the batch; the record's own data is untouched.
        const changedAt = Number.isNaN(Date.parse(change.clientUpdatedAt)) ? new Date().toISOString() : change.clientUpdatedAt
        return { store: change.store, id: change.id, data: deleted ? null : record ?? null, deleted, client_updated_at: changedAt }
      })
      const sendable = rows.filter((row) => !unsendable(row))
      skipped += rows.length - sendable.length
      const rejected = sendable.length > 0 ? await pushBatch(backend, sendable) : 0
      skipped += rejected
      // Set-aside rows are acknowledged too: retrying them would fail the same way forever.
      await acknowledgeChanges(batch)
      pushed += sendable.length - rejected
    }
  } catch (error) {
    pushError = error
  }

  let applied = 0
  try {
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
  } catch (error) {
    throw pushError ?? error
  }
  if (pushError) throw pushError

  return { pushed, applied, skipped }
}
