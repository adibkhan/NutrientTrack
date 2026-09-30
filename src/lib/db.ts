import type { BackupPayload, DiaryEntry, Food, Settings, WeightEntry } from '../types'
import { BACKUP_VERSION } from './backup'

const DB_NAME = 'nutrienttrack-local'

type StoreName = 'entries' | 'foods' | 'weights' | 'settings'

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

const getAll = async <T>(storeName: StoreName): Promise<T[]> => {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readonly')
  return requestToPromise(transaction.objectStore(storeName).getAll())
}

const put = async <T extends { id: string }>(storeName: StoreName, value: T): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  await Promise.all([requestToPromise(transaction.objectStore(storeName).put(value)), transactionToPromise(transaction)])
}

const remove = async (storeName: StoreName, id: string): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  await Promise.all([requestToPromise(transaction.objectStore(storeName).delete(id)), transactionToPromise(transaction)])
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
  const database = await openDatabase()
  const transaction = database.transaction('entries', 'readwrite')
  const completion = transactionToPromise(transaction)
  completion.catch(() => undefined)
  const store = transaction.objectStore('entries')
  queueOrAbort(transaction, () => entries.forEach((entry) => store.put(entry)))
  await completion
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

export const importBackup = async (backup: BackupPayload): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(['entries', 'foods', 'weights', 'settings'], 'readwrite')
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
    backup.entries.forEach((entry) => transaction.objectStore('entries').put(entry))
    backup.foods.forEach((food) => transaction.objectStore('foods').put(food))
    backup.weights.forEach((weight) => transaction.objectStore('weights').put(weight))
    backup.settings.forEach((settings) => transaction.objectStore('settings').put(settings))
  })
  await completion
}

export const clearAllData = async (): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(['entries', 'foods', 'weights', 'settings'], 'readwrite')
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
  })
  await completion
}

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}
