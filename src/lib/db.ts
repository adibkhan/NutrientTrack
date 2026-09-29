import type { BackupPayload, DiaryEntry, Food, Settings, WeightEntry } from '../types'

const DB_NAME = 'nutrienttrack-local'
const DB_VERSION = 1

type StoreName = 'entries' | 'foods' | 'weights' | 'settings'

let databasePromise: Promise<IDBDatabase> | null = null

const openDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      const entries = database.objectStoreNames.contains('entries')
        ? request.transaction?.objectStore('entries')
        : database.createObjectStore('entries', { keyPath: 'id' })
      entries?.indexNames.contains('date') || entries?.createIndex('date', 'date', { unique: false })

      const foods = database.objectStoreNames.contains('foods')
        ? request.transaction?.objectStore('foods')
        : database.createObjectStore('foods', { keyPath: 'id' })
      foods?.indexNames.contains('name') || foods?.createIndex('name', 'name', { unique: false })

      const weights = database.objectStoreNames.contains('weights')
        ? request.transaction?.objectStore('weights')
        : database.createObjectStore('weights', { keyPath: 'id' })
      weights?.indexNames.contains('date') || weights?.createIndex('date', 'date', { unique: false })

      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'id' })
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error ?? new Error('Unable to open local database.')))
  })

  return databasePromise
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
    version: 1,
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
  transaction.objectStore('entries').clear()
  transaction.objectStore('foods').clear()
  transaction.objectStore('weights').clear()
  transaction.objectStore('settings').clear()
  backup.entries.forEach((entry) => transaction.objectStore('entries').put(entry))
  backup.foods.forEach((food) => transaction.objectStore('foods').put(food))
  backup.weights.forEach((weight) => transaction.objectStore('weights').put(weight))
  backup.settings.forEach((settings) => transaction.objectStore('settings').put(settings))
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Unable to import backup.')))
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Backup import was cancelled.')))
  })
}

export const clearAllData = async (): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(['entries', 'foods', 'weights', 'settings'], 'readwrite')
  transaction.objectStore('entries').clear()
  transaction.objectStore('foods').clear()
  transaction.objectStore('weights').clear()
  transaction.objectStore('settings').clear()
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Unable to clear local data.')))
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Clearing local data was cancelled.')))
  })
}

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}
