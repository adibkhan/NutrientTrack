// Runs the real db.ts against fake-indexeddb. Each test gets a brand-new IndexedDB factory.
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupPayload } from '../types'
import fixtureV1 from './__fixtures__/backup-v1.json'
import {
  clearAllData, closeDatabase, DB_VERSION, exportBackup, getEntries, getFoods, getSettings, getWeights, importBackup, onDatabaseEvent,
  saveEntries, saveEntry,
  type DatabaseEvent,
} from './db'

const DB_NAME = 'nutrienttrack-local'
const fixture = () => structuredClone(fixtureV1) as unknown as BackupPayload

const wait = (request: IDBRequest | IDBOpenDBRequest) =>
  new Promise<unknown>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
const done = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('abort', () => reject(transaction.error))
  })

/** Raw connection with no version argument: reports whatever is on disk. */
const inspect = async () => {
  const database = (await wait(indexedDB.open(DB_NAME))) as IDBDatabase
  const transaction = database.transaction([...database.objectStoreNames], 'readonly')
  const shape = {
    version: database.version,
    stores: [...database.objectStoreNames].sort(),
    indexes: Object.fromEntries([...database.objectStoreNames].map((name) => [name, [...transaction.objectStore(name).indexNames].sort()])),
  }
  database.close()
  return shape
}

/** Mirrors the ORIGINAL pre-numbering schema from HEAD's src/lib/db.ts (version 1), then stores a backup in it. */
const createLegacyV1Database = async (backup: BackupPayload) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.addEventListener('upgradeneeded', () => {
    const database = request.result
    const entries = database.createObjectStore('entries', { keyPath: 'id' })
    entries.createIndex('date', 'date', { unique: false })
    const foods = database.createObjectStore('foods', { keyPath: 'id' })
    foods.createIndex('name', 'name', { unique: false })
    const weights = database.createObjectStore('weights', { keyPath: 'id' })
    weights.createIndex('date', 'date', { unique: false })
    database.createObjectStore('settings', { keyPath: 'id' })
  })
  const database = (await wait(request)) as IDBDatabase
  const transaction = database.transaction(['entries', 'foods', 'weights', 'settings'], 'readwrite')
  backup.entries.forEach((item) => transaction.objectStore('entries').put(item))
  backup.foods.forEach((item) => transaction.objectStore('foods').put(item))
  backup.weights.forEach((item) => transaction.objectStore('weights').put(item))
  backup.settings.forEach((item) => transaction.objectStore('settings').put(item))
  await done(transaction)
  database.close()
}

const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
const normalized = (backup: BackupPayload) => ({
  ...backup,
  exportedAt: undefined,
  entries: byId(backup.entries),
  foods: byId(backup.foods),
  weights: byId(backup.weights),
})

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(async () => {
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('opening the database', () => {
  it('creates every store and index at DB_VERSION on a fresh browser', async () => {
    expect(await getEntries()).toEqual([])
    await closeDatabase()
    expect(await inspect()).toEqual({
      version: DB_VERSION,
      stores: ['entries', 'foods', 'settings', 'weights'],
      indexes: { entries: ['date'], foods: ['name'], settings: [], weights: ['date'] },
    })
  })

  it('reads an empty first-run database without settings', async () => {
    expect(await getSettings()).toBeUndefined()
    expect(await getFoods()).toEqual([])
    expect(await getWeights()).toEqual([])
  })

  it('opens a database created by the pre-numbering schema with all data intact', async () => {
    const source = fixture()
    await createLegacyV1Database(source)

    expect(byId(await getEntries())).toEqual(byId(source.entries))
    expect(byId(await getFoods())).toEqual(byId(source.foods))
    expect(byId(await getWeights())).toEqual(byId(source.weights))
    expect(await getSettings()).toEqual(source.settings[0])

    await closeDatabase()
    expect(await inspect()).toEqual({
      version: DB_VERSION,
      stores: ['entries', 'foods', 'settings', 'weights'],
      indexes: { entries: ['date'], foods: ['name'], settings: [], weights: ['date'] },
    })
  })

  it('rejects when the stored database is newer than this build, then opens once it is gone', async () => {
    const newer = (await wait(indexedDB.open(DB_NAME, DB_VERSION + 4))) as IDBDatabase
    newer.close()
    await expect(getEntries()).rejects.toBeTruthy()

    await wait(indexedDB.deleteDatabase(DB_NAME))
    expect(await getEntries()).toEqual([])
  })
})

describe('backup round trip', () => {
  it('exports exactly what was imported, unknown fields included', async () => {
    const source = fixture()
    await importBackup(source)
    const exported = await exportBackup()

    expect(exported.exportedAt).not.toBe(source.exportedAt)
    expect(normalized(exported)).toEqual(normalized(source))
    expect((exported.entries.find((e) => e.id === 'entry-saved-1') as unknown as Record<string, unknown>).sodium).toBe(120)
    expect((exported.settings[0] as unknown as Record<string, unknown>).theme).toBe('dark')
  })

  it('replaces existing data when importing twice in a row', async () => {
    await importBackup(fixture())
    const second = fixture()
    second.entries = second.entries.slice(0, 1)
    await importBackup(second)
    expect(await getEntries()).toHaveLength(1)
  })

  it('imports an empty backup, leaving an empty database', async () => {
    await importBackup(fixture())
    await importBackup({ ...fixture(), entries: [], foods: [], weights: [], settings: [] })
    const exported = await exportBackup()
    expect([exported.entries, exported.foods, exported.weights, exported.settings]).toEqual([[], [], [], []])
  })

  it('is atomic: a record that cannot be stored leaves the previous data untouched', async () => {
    await importBackup(fixture())
    const before = normalized(await exportBackup())

    const broken = fixture()
    broken.entries = [{ ...broken.entries[0], id: 'replacement' }, { name: 'no id' } as never]
    broken.foods = []
    await expect(importBackup(broken)).rejects.toBeTruthy()

    expect(normalized(await exportBackup())).toEqual(before)
  })
})

describe('import atomicity under a mid-transaction failure', () => {
  it('keeps the previous data when the transaction aborts after some records were written', async () => {
    await importBackup(fixture())
    const before = normalized(await exportBackup())

    const replacement = fixture()
    replacement.entries = [{ ...replacement.entries[0], id: 'replacement' }]
    replacement.weights = []
    const realPut = IDBObjectStore.prototype.put
    let calls = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = realPut.apply(this, args)
      calls += 1
      if (calls === 2) this.transaction.abort() // e.g. quota exceeded partway through
      return request
    })
    await expect(importBackup(replacement)).rejects.toBeTruthy()
    vi.restoreAllMocks()

    expect(normalized(await exportBackup())).toEqual(before)
  })
})

describe('clear and batch writes are all-or-nothing', () => {
  it('clears every store', async () => {
    await importBackup(fixture())
    await clearAllData()
    const exported = await exportBackup()
    expect([exported.entries, exported.foods, exported.weights, exported.settings]).toEqual([[], [], [], []])
  })

  it('clears nothing when a clear throws partway through queuing', async () => {
    await importBackup(fixture())
    const before = normalized(await exportBackup())
    const realClear = IDBObjectStore.prototype.clear
    let calls = 0
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      calls += 1
      if (calls === 3) throw new DOMException('Simulated failure', 'InvalidStateError')
      return realClear.apply(this)
    })
    await expect(clearAllData()).rejects.toBeTruthy()
    vi.restoreAllMocks()
    expect(normalized(await exportBackup())).toEqual(before)
  })

  it('saves no entries from a batch when one record is rejected while queuing', async () => {
    const [first] = fixture().entries
    await expect(saveEntries([{ ...first, id: 'batch-ok' }, { name: 'no id' } as never])).rejects.toBeTruthy()
    expect(await getEntries()).toEqual([])
  })
})

describe('database events', () => {
  it('tells listeners about a blocked upgrade', async () => {
    const realFactory = new IDBFactory()
    const events: DatabaseEvent[] = []
    onDatabaseEvent((event) => events.push(event))
    vi.stubGlobal('indexedDB', {
      open: (name: string, version?: number) => {
        const request = realFactory.open(name, version)
        // A real request reports 'blocked' when another tab still holds an older connection; simulate that signal.
        const addEventListener = request.addEventListener.bind(request) as (type: string, listener: EventListener) => void
        request.addEventListener = ((type: string, listener: EventListener) => {
          if (type === 'blocked') listener(new Event('blocked'))
          else addEventListener(type, listener)
        }) as typeof request.addEventListener
        return request
      },
    })
    await getEntries()
    expect(events).toEqual(['blocked'])
  })

  it('closes its connection and notifies when another tab upgrades, without blocking the upgrade', async () => {
    await importBackup(fixture())
    const events: DatabaseEvent[] = []
    onDatabaseEvent((event) => events.push(event))

    const other = (await wait(indexedDB.open(DB_NAME, DB_VERSION + 1))) as IDBDatabase
    expect(events).toEqual(['versionchange'])
    expect(other.version).toBe(DB_VERSION + 1)
    other.close()
  })

  it('opens a fresh connection on the next call after a versionchange', async () => {
    await importBackup(fixture())
    const events: DatabaseEvent[] = []
    onDatabaseEvent((event) => events.push(event))

    await wait(indexedDB.deleteDatabase(DB_NAME)) // another tab wiping the database also fires versionchange
    expect(events).toEqual(['versionchange'])

    expect(await getEntries()).toEqual([])
    await saveEntry({ ...fixture().entries[0], id: 'after-reopen' })
    expect((await getEntries()).map((e) => e.id)).toEqual(['after-reopen'])
  })

  it('stops notifying a listener once it has unsubscribed, and tolerates unsubscribing twice', async () => {
    const kept: DatabaseEvent[] = []
    const dropped: DatabaseEvent[] = []
    onDatabaseEvent((event) => kept.push(event))
    const unsubscribe = onDatabaseEvent((event) => dropped.push(event))
    await getEntries()
    unsubscribe()
    unsubscribe()

    await wait(indexedDB.deleteDatabase(DB_NAME))
    expect(kept).toEqual(['versionchange'])
    expect(dropped).toEqual([])
  })
})
