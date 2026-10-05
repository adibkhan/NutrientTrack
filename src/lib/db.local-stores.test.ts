// Water and body measurements: device-only stores added by migration 3. They round trip, are backed up, and never touch the sync outbox.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupPayload, BodyMeasurement, DiaryEntry, WaterLog } from '../types'
import {
  clearAllData, closeDatabase, DB_VERSION, deleteMeasurement, deleteWaterLog, exportBackup, getEntries, getFoods, getMeasurements, getPendingChanges,
  getSettings, getWaterLogs, getWeights, importBackup, saveEntry, saveMeasurement, saveWaterLog, setMeta,
} from './db'

const DB_NAME = 'nutrienttrack-local'
const stamp = '2026-01-01T00:00:00.000Z'

const water = (date: string, ml = 237, extra: Record<string, unknown> = {}): WaterLog => ({ id: date, date, ml, createdAt: stamp, updatedAt: stamp, ...extra }) as WaterLog
const measure = (date: string, extra: Record<string, unknown> = {}): BodyMeasurement =>
  ({ id: date, date, unit: 'in', waist: 34.5, createdAt: stamp, updatedAt: stamp, ...extra }) as BodyMeasurement
const entry = (id: string): DiaryEntry => ({ id, date: '2026-01-02', meal: 'lunch', name: 'Soup', calories: 100, protein: 5, carbs: 10, fat: 2, createdAt: stamp, updatedAt: stamp })

const payload = (over: Partial<BackupPayload> = {}): BackupPayload => ({
  format: 'nutrienttrack-backup', version: 2, exportedAt: stamp, entries: [], foods: [], weights: [], settings: [], water: [], measurements: [], ...over,
})

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

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(async () => {
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('water and measurement records', () => {
  it('starts empty on a first run', async () => {
    expect(await getWaterLogs()).toEqual([])
    expect(await getMeasurements()).toEqual([])
  })

  it('round trips a water log with its unknown fields', async () => {
    const log = water('2026-03-01', 474, { futureField: { kept: true } })
    await saveWaterLog(log)
    expect(await getWaterLogs()).toEqual([log])
  })

  it('replaces a water log saved twice under the same id', async () => {
    await saveWaterLog(water('2026-03-01', 237))
    await saveWaterLog(water('2026-03-01', 474))
    expect(await getWaterLogs()).toEqual([water('2026-03-01', 474)])
  })

  it('deletes a water log and tolerates deleting one that is not there', async () => {
    await saveWaterLog(water('2026-03-01'))
    await deleteWaterLog('2026-03-01')
    await deleteWaterLog('2026-03-01')
    expect(await getWaterLogs()).toEqual([])
  })

  it('round trips a measurement without adding keys for parts not measured', async () => {
    const record = measure('2026-03-01', { futureField: 1 })
    await saveMeasurement(record)
    const [stored] = await getMeasurements()
    expect(stored).toEqual(record)
    expect(stored).not.toHaveProperty('hips')
  })

  it('deletes a measurement', async () => {
    await saveMeasurement(measure('2026-03-01'))
    await saveMeasurement(measure('2026-03-02'))
    await deleteMeasurement('2026-03-01')
    expect((await getMeasurements()).map((item) => item.id)).toEqual(['2026-03-02'])
  })
})

describe('water and measurements never reach the sync outbox', () => {
  it('queues nothing when saving or deleting, before the first sync', async () => {
    await saveWaterLog(water('2026-03-01'))
    await saveMeasurement(measure('2026-03-01'))
    await deleteWaterLog('2026-03-01')
    await deleteMeasurement('2026-03-01')
    expect(await getPendingChanges()).toEqual([])
  })

  it('queues nothing when saving or deleting, once the device has synced', async () => {
    await setMeta('everSynced', true)
    await saveWaterLog(water('2026-03-01'))
    await saveMeasurement(measure('2026-03-01'))
    await deleteWaterLog('2026-03-01')
    await deleteMeasurement('2026-03-01')
    expect(await getPendingChanges()).toEqual([])
  })

  it('still queues diary entries, so the outbox itself works', async () => {
    await saveEntry(entry('e1'))
    expect((await getPendingChanges()).map((change) => change.key)).toEqual(['entries:e1'])
  })
})

describe('backup with water and measurements', () => {
  it('exports them at the current version', async () => {
    await saveWaterLog(water('2026-03-01'))
    await saveMeasurement(measure('2026-03-01'))
    const backup = await exportBackup()
    expect(backup.version).toBe(2)
    expect(backup.water).toEqual([water('2026-03-01')])
    expect(backup.measurements).toEqual([measure('2026-03-01')])
  })

  it('exports empty arrays, not missing keys, on a first run', async () => {
    const backup = await exportBackup()
    expect(backup.water).toEqual([])
    expect(backup.measurements).toEqual([])
  })

  it('replaces existing water and measurements on import, keeping unknown fields', async () => {
    await saveWaterLog(water('2026-03-01', 500))
    await saveMeasurement(measure('2026-03-01'))
    await importBackup(payload({ water: [water('2026-04-01', 237, { extra: 'x' })], measurements: [measure('2026-04-01', { hips: 40 })] }))
    expect(await getWaterLogs()).toEqual([water('2026-04-01', 237, { extra: 'x' })])
    expect(await getMeasurements()).toEqual([measure('2026-04-01', { hips: 40 })])
  })

  it('does not queue water or measurements for sync when importing', async () => {
    await importBackup(payload({ water: [water('2026-04-01')], measurements: [measure('2026-04-01')] }))
    expect(await getPendingChanges()).toEqual([])
  })

  it('still imports the rest when the payload lacks the water and measurements arrays', async () => {
    await saveWaterLog(water('2026-03-01'))
    const { water: _water, measurements: _measurements, ...rest } = payload({ entries: [entry('e1')] })
    await importBackup(rest as unknown as BackupPayload)
    expect((await getEntries()).map((item) => item.id)).toEqual(['e1'])
    expect(await getWaterLogs()).toEqual([])
    expect(await getMeasurements()).toEqual([])
  })

  it('rolls everything back when a measurement fails mid-import', async () => {
    await saveEntry(entry('keep'))
    await saveWaterLog(water('2026-03-01'))
    await saveMeasurement(measure('2026-03-01'))
    const broken = payload({ entries: [entry('new')], water: [water('2026-04-01')], measurements: [{ date: '2026-04-01' } as unknown as BodyMeasurement] })
    await expect(importBackup(broken)).rejects.toBeTruthy()
    expect((await getEntries()).map((item) => item.id)).toEqual(['keep'])
    expect(await getWaterLogs()).toEqual([water('2026-03-01')])
    expect(await getMeasurements()).toEqual([measure('2026-03-01')])
  })

  it('clears water and measurements with everything else', async () => {
    await saveEntry(entry('e1'))
    await saveWaterLog(water('2026-03-01'))
    await saveMeasurement(measure('2026-03-01'))
    await clearAllData()
    expect(await getWaterLogs()).toEqual([])
    expect(await getMeasurements()).toEqual([])
    expect(await getEntries()).toEqual([])
    expect(await getFoods()).toEqual([])
    expect(await getWeights()).toEqual([])
    expect(await getSettings()).toBeUndefined()
  })
})

describe('upgrading a version 2 database', () => {
  /** Mirrors MIGRATIONS steps 1 and 2 exactly: the schema a browser holds before water and measurements existed. */
  const createV2Database = async () => {
    const request = indexedDB.open(DB_NAME, 2)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      database.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date', { unique: false })
      database.createObjectStore('foods', { keyPath: 'id' }).createIndex('name', 'name', { unique: false })
      database.createObjectStore('weights', { keyPath: 'id' }).createIndex('date', 'date', { unique: false })
      database.createObjectStore('settings', { keyPath: 'id' })
      database.createObjectStore('outbox', { keyPath: 'key' })
      database.createObjectStore('meta', { keyPath: 'key' })
    })
    const database = (await wait(request)) as IDBDatabase
    const transaction = database.transaction(['entries', 'outbox', 'meta', 'settings'], 'readwrite')
    transaction.objectStore('entries').put({ ...entry('old'), futureField: 'kept' })
    transaction.objectStore('settings').put({ id: 'profile', goals: { weightUnit: 'lb' }, updatedAt: stamp, futureSettingsField: 1 })
    transaction.objectStore('outbox').put({ key: 'entries:old', store: 'entries', id: 'old', deleted: false, clientUpdatedAt: stamp })
    transaction.objectStore('meta').put({ key: 'everSynced', value: true })
    await done(transaction)
    database.close()
  }

  it('upgrades to the current version with its data intact and both new stores present', async () => {
    await createV2Database()
    expect(DB_VERSION).toBeGreaterThanOrEqual(3)

    expect(await getEntries()).toEqual([{ ...entry('old'), futureField: 'kept' }])
    expect(await getSettings()).toMatchObject({ id: 'profile', futureSettingsField: 1 })
    expect((await getPendingChanges()).map((change) => change.key)).toEqual(['entries:old'])
    expect(await getWaterLogs()).toEqual([])
    expect(await getMeasurements()).toEqual([])

    await closeDatabase()
    const database = (await wait(indexedDB.open(DB_NAME))) as IDBDatabase
    expect(database.version).toBe(DB_VERSION)
    expect([...database.objectStoreNames]).toEqual(expect.arrayContaining(['water', 'measurements']))
    database.close()
  })

  it('accepts water and measurements after upgrading', async () => {
    await createV2Database()
    await saveWaterLog(water('2026-03-01'))
    await saveMeasurement(measure('2026-03-01'))
    expect(await getWaterLogs()).toHaveLength(1)
    expect(await getMeasurements()).toHaveLength(1)
  })
})
