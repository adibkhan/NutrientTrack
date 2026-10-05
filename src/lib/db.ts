import type { BackupPayload, BodyMeasurement, DiaryEntry, Food, Settings, WaterLog, WeightEntry } from '../types'
import { BACKUP_VERSION, isValidSyncRecord } from './backup'

const DB_NAME = 'nutrienttrack-local'

type StoreName = 'entries' | 'foods' | 'weights' | 'settings'

/** Stores that live only on this device and in backups. They are not synced to the cloud yet, so they never touch the outbox. */
type LocalStoreName = 'water' | 'measurements'

/** A local change waiting to be pushed to cloud sync. One per record: a later change replaces an earlier one. */
export interface PendingChange {
  key: string
  store: StoreName
  id: string
  deleted: boolean
  clientUpdatedAt: string
}

type Migration = (database: IDBDatabase, transaction: IDBTransaction) => void

/**
 * Ordered schema steps. Step N upgrades a version N-1 database to version N, so a browser on any older
 * version runs every later step in turn. Never edit or remove a shipped step; append a new one instead,
 * and add a fixture test that upgrades from every earlier version.
 */
const MIGRATIONS: Migration[] = [
  // 1: initial stores and indexes. Written to be safe on databases created before steps were numbered.
  (database, transaction) => {
    const entries = database.objectStoreNames.contains('entries')
      ? transaction.objectStore('entries')
      : database.createObjectStore('entries', { keyPath: 'id' })
    if (!entries.indexNames.contains('date')) entries.createIndex('date', 'date', { unique: false })

    const foods = database.objectStoreNames.contains('foods')
      ? transaction.objectStore('foods')
      : database.createObjectStore('foods', { keyPath: 'id' })
    if (!foods.indexNames.contains('name')) foods.createIndex('name', 'name', { unique: false })

    const weights = database.objectStoreNames.contains('weights')
      ? transaction.objectStore('weights')
      : database.createObjectStore('weights', { keyPath: 'id' })
    if (!weights.indexNames.contains('date')) weights.createIndex('date', 'date', { unique: false })

    if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'id' })
  },
  // 2: cloud sync bookkeeping. outbox holds unsent changes; meta holds sync state such as the pull cursor.
  (database) => {
    database.createObjectStore('outbox', { keyPath: 'key' })
    database.createObjectStore('meta', { keyPath: 'key' })
  },
  // 3: daily water totals and body measurements. New stores only; no existing record is read or rewritten.
  (database) => {
    database.createObjectStore('water', { keyPath: 'id' })
    database.createObjectStore('measurements', { keyPath: 'id' })
  },
]

export const DB_VERSION = MIGRATIONS.length

/** 'blocked': another open tab holds an older version and must close before the upgrade can finish.
 *  'versionchange': another tab upgraded the database; this tab has closed its connection and must reload. */
export type DatabaseEvent = 'blocked' | 'versionchange'

const databaseListeners = new Set<(event: DatabaseEvent) => void>()

export const onDatabaseEvent = (listener: (event: DatabaseEvent) => void): (() => void) => {
  databaseListeners.add(listener)
  return () => databaseListeners.delete(listener)
}

const notify = (event: DatabaseEvent) => databaseListeners.forEach((listener) => listener(event))

const localChangeListeners = new Set<() => void>()

/** Called after any local write that queued a change for sync. Returns an unsubscribe function. */
export const onLocalChange = (listener: () => void): (() => void) => {
  localChangeListeners.add(listener)
  return () => localChangeListeners.delete(listener)
}

const notifyLocalChange = () => localChangeListeners.forEach((listener) => listener())

let databasePromise: Promise<IDBDatabase> | null = null

const openDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.addEventListener('upgradeneeded', (event) => {
      const transaction = request.transaction
      if (!transaction) return
      for (let version = event.oldVersion + 1; version <= DB_VERSION; version += 1) {
        MIGRATIONS[version - 1](request.result, transaction)
      }
    })
    request.addEventListener('blocked', () => notify('blocked'))
    request.addEventListener('success', () => {
      const database = request.result
      // Let a newer tab upgrade: close this connection instead of blocking it, and tell the UI to reload.
      database.addEventListener('versionchange', () => {
        database.close()
        databasePromise = null
        notify('versionchange')
      })
      resolve(database)
    })
    request.addEventListener('error', () => {
      databasePromise = null
      reject(request.error ?? new Error('Unable to open local database.'))
    })
  })

  return databasePromise
}

/** Close the shared connection. Used by tests and before replacing the database. */
export const closeDatabase = async (): Promise<void> => {
  const pending = databasePromise
  databasePromise = null
  if (pending) (await pending.catch(() => undefined))?.close()
}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error ?? new Error('Local database request failed.')))
  })

const transactionToPromise = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Local database transaction failed.')))
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Local database transaction was aborted.')))
  })

/** Queue writes on a transaction; if queuing throws (e.g. a record the store rejects), abort so nothing already queued commits. */
const queueOrAbort = (transaction: IDBTransaction, work: () => void) => {
  try {
    work()
  } catch (error) {
    transaction.abort()
    throw error
  }
}

/** Run `work` in one transaction: aborts if queuing throws, resolves once it commits, rejects if it aborts. */
const runTransaction = async (storeNames: string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => void): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(storeNames, mode)
  const completion = transactionToPromise(transaction)
  completion.catch(() => undefined)
  queueOrAbort(transaction, () => work(transaction))
  await completion
}

const changeFor = (store: StoreName, record: { id: string; updatedAt?: string }, deleted = false): PendingChange => ({
  key: `${store}:${record.id}`,
  store,
  id: record.id,
  deleted,
  clientUpdatedAt: (!deleted && record.updatedAt) || new Date().toISOString(),
})

const getAll = async <T>(storeName: StoreName | LocalStoreName | 'outbox'): Promise<T[]> => {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  return requestToPromise(transaction.objectStore(storeName).getAll())
}

/** Run writes to a store and record their pending sync changes in the same transaction, so neither can be lost alone. */
const writeWithChanges = async (storeName: StoreName, work: (store: IDBObjectStore, outbox: IDBObjectStore) => void): Promise<void> => {
  await runTransaction([storeName, 'outbox'], 'readwrite', (transaction) => work(transaction.objectStore(storeName), transaction.objectStore('outbox')))
  notifyLocalChange()
}

const put = <T extends { id: string; updatedAt?: string }>(storeName: StoreName, value: T): Promise<void> =>
  writeWithChanges(storeName, (store, outbox) => {
    store.put(value)
    outbox.put(changeFor(storeName, value))
  })

const remove = async (storeName: StoreName, id: string): Promise<void> => {
  // A device that never used sync has nothing to tell the cloud; queueing deletes would only pile up forever.
  const syncUsed = (await getMeta<boolean>('everSynced')) === true
  await writeWithChanges(storeName, (store, outbox) => {
    store.delete(id)
    if (syncUsed) outbox.put(changeFor(storeName, { id }, true))
    else outbox.delete(`${storeName}:${id}`)
  })
}

export const getEntries = (): Promise<DiaryEntry[]> => getAll<DiaryEntry>('entries')
export const getFoods = (): Promise<Food[]> => getAll<Food>('foods')
export const getWeights = (): Promise<WeightEntry[]> => getAll<WeightEntry>('weights')
export const getSettings = async (): Promise<Settings | undefined> => {
  const database = await openDatabase()
  const transaction = database.transaction('settings', 'readonly')
  return requestToPromise(transaction.objectStore('settings').get('profile'))
}

export const saveEntry = (entry: DiaryEntry): Promise<void> => put('entries', entry)
/** Persist a group of diary entries in one transaction so a repeated meal is all-or-nothing. */
export const saveEntries = async (entries: DiaryEntry[]): Promise<void> => {
  if (entries.length === 0) return
  await writeWithChanges('entries', (store, outbox) => entries.forEach((entry) => {
    store.put(entry)
    outbox.put(changeFor('entries', entry))
  }))
}
export const deleteEntry = (id: string): Promise<void> => remove('entries', id)
export const saveFood = (food: Food): Promise<void> => put('foods', food)
export const deleteFood = (id: string): Promise<void> => remove('foods', id)
export const saveWeight = (weight: WeightEntry): Promise<void> => put('weights', weight)
export const deleteWeight = (id: string): Promise<void> => remove('weights', id)
export const saveSettings = (settings: Settings): Promise<void> => put('settings', settings)

export const getWaterLogs = (): Promise<WaterLog[]> => getAll<WaterLog>('water')
export const saveWaterLog = (log: WaterLog): Promise<void> => runTransaction(['water'], 'readwrite', (transaction) => { transaction.objectStore('water').put(log) })
export const deleteWaterLog = (id: string): Promise<void> => runTransaction(['water'], 'readwrite', (transaction) => { transaction.objectStore('water').delete(id) })
export const getMeasurements = (): Promise<BodyMeasurement[]> => getAll<BodyMeasurement>('measurements')
export const saveMeasurement = (measurement: BodyMeasurement): Promise<void> => runTransaction(['measurements'], 'readwrite', (transaction) => { transaction.objectStore('measurements').put(measurement) })
export const deleteMeasurement = (id: string): Promise<void> => runTransaction(['measurements'], 'readwrite', (transaction) => { transaction.objectStore('measurements').delete(id) })

export const exportBackup = async (): Promise<BackupPayload> => {
  const [entries, foods, weights, settings, water, measurements] = await Promise.all([getEntries(), getFoods(), getWeights(), getSettings(), getWaterLogs(), getMeasurements()])
  return {
    format: 'nutrienttrack-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    foods,
    weights,
    settings: settings ? [settings] : [],
    water,
    measurements,
  }
}

/**
 * Replace local data with a backup. Restored records are queued for sync and win over cloud copies. Records the
 * backup lacks are NOT deleted from the cloud: the pull cursor is reset so the next sync brings them back.
 */
export const importBackup = async (backup: BackupPayload): Promise<void> => {
  await runTransaction(['entries', 'foods', 'weights', 'settings', 'water', 'measurements', 'outbox', 'meta'], 'readwrite', (transaction) => {
    transaction.objectStore('meta').delete('pullCursor')
    transaction.objectStore('water').clear()
    transaction.objectStore('measurements').clear()
    for (const log of backup.water ?? []) transaction.objectStore('water').put(log)
    for (const measurement of backup.measurements ?? []) transaction.objectStore('measurements').put(measurement)
    transaction.objectStore('entries').clear()
    transaction.objectStore('foods').clear()
    transaction.objectStore('weights').clear()
    transaction.objectStore('settings').clear()
    const outbox = transaction.objectStore('outbox')
    // A restore is a deliberate new change: stamp it now so it wins over newer cloud copies. Record data is untouched.
    const restoredAt = new Date().toISOString()
    const restore = (store: StoreName, records: Array<{ id: string; updatedAt?: string }>) => records.forEach((record) => {
      transaction.objectStore(store).put(record)
      outbox.put({ ...changeFor(store, record), clientUpdatedAt: restoredAt })
    })
    restore('entries', backup.entries)
    restore('foods', backup.foods)
    restore('weights', backup.weights)
    restore('settings', backup.settings)
  })
  notifyLocalChange()
}

/** Clear this browser only, including sync bookkeeping. Never deletes anything from the cloud. */
export const clearAllData = (): Promise<void> =>
  runTransaction(['entries', 'foods', 'weights', 'settings', 'water', 'measurements', 'outbox', 'meta'], 'readwrite', (transaction) => {
    for (const name of ['entries', 'foods', 'weights', 'settings', 'water', 'measurements', 'outbox', 'meta']) transaction.objectStore(name).clear()
  })

export const getPendingChanges = (): Promise<PendingChange[]> => getAll<PendingChange>('outbox')

/** Drop pushed changes, but only those not replaced by a newer local change while the push was in flight. */
export const acknowledgeChanges = async (changes: PendingChange[]): Promise<void> => {
  if (changes.length === 0) return
  await runTransaction(['outbox'], 'readwrite', (transaction) => {
    const outbox = transaction.objectStore('outbox')
    for (const change of changes) {
      const request = outbox.get(change.key)
      request.addEventListener('success', () => {
        const current = request.result as PendingChange | undefined
        if (current && current.clientUpdatedAt === change.clientUpdatedAt && current.deleted === change.deleted) outbox.delete(change.key)
      })
    }
  })
}

const SYNCED_STORES: StoreName[] = ['entries', 'foods', 'weights', 'settings']

/** A change as stored in the cloud (public.sync_records). */
export interface RemoteChange {
  store: StoreName
  id: string
  data: Record<string, unknown> | null
  deleted: boolean
  client_updated_at: string
  server_updated_at: string
}

/** Read the current local record behind each pending change (undefined once deleted). */
export const readChangedRecords = async (changes: PendingChange[]): Promise<Array<Record<string, unknown> | undefined>> => {
  if (changes.length === 0) return []
  const database = await openDatabase()
  const transaction = database.transaction(SYNCED_STORES, 'readonly')
  return Promise.all(changes.map((change) => requestToPromise(transaction.objectStore(change.store).get(change.id))))
}

/**
 * Apply cloud changes locally without queueing them again. Last write wins: a change is skipped when this device
 * holds a newer unsent change for the same record, and an older unsent change is dropped in favour of the cloud's.
 * A cloud record that fails the same checks a backup file must pass is skipped, so one malformed row cannot
 * break the app. Returns how many records changed.
 */
export const applyRemoteChanges = async (changes: RemoteChange[]): Promise<number> => {
  const usable = changes.filter((change) => SYNCED_STORES.includes(change.store))
  if (usable.length === 0) return 0
  let applied = 0
  await runTransaction([...SYNCED_STORES, 'outbox'], 'readwrite', (transaction) => {
    const outbox = transaction.objectStore('outbox')
    for (const change of usable) {
      const key = `${change.store}:${change.id}`
      const removal = change.deleted || !change.data
      if (!removal && !isValidSyncRecord(change.store, change.data, change.id)) continue
      const request = outbox.get(key)
      request.addEventListener('success', () => {
        const pending = request.result as PendingChange | undefined
        if (pending && new Date(pending.clientUpdatedAt) >= new Date(change.client_updated_at)) return
        if (pending) outbox.delete(key)
        const store = transaction.objectStore(change.store)
        if (removal) store.delete(change.id)
        else store.put(change.data)
        applied += 1
      })
    }
  })
  return applied
}

/** Queue every local record, e.g. when this device first turns on sync with data it logged before. */
export const queueAllRecords = (): Promise<void> =>
  runTransaction([...SYNCED_STORES, 'outbox'], 'readwrite', (transaction) => {
    const outbox = transaction.objectStore('outbox')
    for (const storeName of SYNCED_STORES) {
      const request = transaction.objectStore(storeName).getAll()
      request.addEventListener('success', () => {
        for (const record of request.result as Array<{ id: string; updatedAt?: string }>) {
          const existing = outbox.get(`${storeName}:${record.id}`)
          existing.addEventListener('success', () => {
            if (!existing.result) outbox.put(changeFor(storeName, record))
          })
        }
      })
    }
  })

export const getMeta = async <T>(key: string): Promise<T | undefined> => {
  const database = await openDatabase()
  const row = await requestToPromise(database.transaction('meta', 'readonly').objectStore('meta').get(key)) as { key: string; value: T } | undefined
  return row?.value
}

export const setMeta = (key: string, value: unknown): Promise<void> =>
  runTransaction(['meta'], 'readwrite', (transaction) => {
    if (value === undefined) transaction.objectStore('meta').delete(key)
    else transaction.objectStore('meta').put({ key, value })
  })

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}
