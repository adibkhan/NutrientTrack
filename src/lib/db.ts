import type { BackupPayload, DiaryEntry, Food, Settings, WeightEntry } from '../types'
import { BACKUP_VERSION } from './backup'

const DB_NAME = 'nutrienttrack-local'

type StoreName = 'entries' | 'foods' | 'weights' | 'settings'

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

const changeFor = (store: StoreName, record: { id: string; updatedAt?: string }, deleted = false): PendingChange => ({
  key: `${store}:${record.id}`,
  store,
  id: record.id,
  deleted,
  clientUpdatedAt: (!deleted && record.updatedAt) || new Date().toISOString(),
})

const getAll = async <T>(storeName: StoreName | 'outbox'): Promise<T[]> => {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  return requestToPromise(transaction.objectStore(storeName).getAll())
}

/** Run writes to a store and record their pending sync changes in the same transaction, so neither can be lost alone. */
const writeWithChanges = async (storeName: StoreName, work: (store: IDBObjectStore, outbox: IDBObjectStore) => void): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction([storeName, 'outbox'], 'readwrite')
  const completion = transactionToPromise(transaction)
  completion.catch(() => undefined)
  queueOrAbort(transaction, () => work(transaction.objectStore(storeName), transaction.objectStore('outbox')))
  await completion
}

const put = <T extends { id: string; updatedAt?: string }>(storeName: StoreName, value: T): Promise<void> =>
  writeWithChanges(storeName, (store, outbox) => {
    store.put(value)
    outbox.put(changeFor(storeName, value))
  })

const remove = (storeName: StoreName, id: string): Promise<void> =>
  writeWithChanges(storeName, (store, outbox) => {
    store.delete(id)
    outbox.put(changeFor(storeName, { id }, true))
  })

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

export const exportBackup = async (): Promise<BackupPayload> => {
  const [entries, foods, weights, settings] = await Promise.all([getEntries(), getFoods(), getWeights(), getSettings()])
  return {
    format: 'nutrienttrack-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    foods,
    weights,
    settings: settings ? [settings] : [],
  }
}

/** Replace local data with a backup. Restored records are queued for sync; records it removes are NOT deleted from the cloud. */
export const importBackup = async (backup: BackupPayload): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(['entries', 'foods', 'weights', 'settings', 'outbox'], 'readwrite')
  const completion = new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Unable to import backup.')))
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Backup import was cancelled.')))
  })
  completion.catch(() => undefined)
  queueOrAbort(transaction, () => {
    transaction.objectStore('entries').clear()
    transaction.objectStore('foods').clear()
    transaction.objectStore('weights').clear()
    transaction.objectStore('settings').clear()
    const outbox = transaction.objectStore('outbox')
    const restore = (store: StoreName, records: Array<{ id: string; updatedAt?: string }>) => records.forEach((record) => {
      transaction.objectStore(store).put(record)
      outbox.put(changeFor(store, record))
    })
    restore('entries', backup.entries)
    restore('foods', backup.foods)
    restore('weights', backup.weights)
    restore('settings', backup.settings)
  })
  await completion
}

/** Clear this browser only, including sync bookkeeping. Never deletes anything from the cloud. */
export const clearAllData = async (): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(['entries', 'foods', 'weights', 'settings', 'outbox', 'meta'], 'readwrite')
  const completion = new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Unable to clear local data.')))
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Clearing local data was cancelled.')))
  })
  completion.catch(() => undefined)
  queueOrAbort(transaction, () => {
    transaction.objectStore('entries').clear()
    transaction.objectStore('foods').clear()
    transaction.objectStore('weights').clear()
    transaction.objectStore('settings').clear()
    transaction.objectStore('outbox').clear()
    transaction.objectStore('meta').clear()
  })
  await completion
}

export const getPendingChanges = (): Promise<PendingChange[]> => getAll<PendingChange>('outbox')

/** Drop pushed changes, but only those not replaced by a newer local change while the push was in flight. */
export const acknowledgeChanges = async (changes: PendingChange[]): Promise<void> => {
  if (changes.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction('outbox', 'readwrite')
  const completion = transactionToPromise(transaction)
  completion.catch(() => undefined)
  const outbox = transaction.objectStore('outbox')
  for (const change of changes) {
    const request = outbox.get(change.key)
    request.addEventListener('success', () => {
      const current = request.result as PendingChange | undefined
      if (current && current.clientUpdatedAt === change.clientUpdatedAt && current.deleted === change.deleted) outbox.delete(change.key)
    })
  }
  await completion
}

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}
