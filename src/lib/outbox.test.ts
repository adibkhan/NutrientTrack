// The local change queue (outbox) that cloud sync pushes from. Runs the real db.ts on fake-indexeddb.
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupPayload, DiaryEntry, WeightEntry } from '../types'
import fixtureV1 from './__fixtures__/backup-v1.json'
import {
  acknowledgeChanges, clearAllData, closeDatabase, deleteEntry, getEntries, getPendingChanges, importBackup,
  saveEntries, saveEntry, saveWeight,
} from './db'

const fixture = () => structuredClone(fixtureV1) as unknown as BackupPayload
const entry = (id: string, updatedAt: string): DiaryEntry => ({
  id, date: '2026-09-30', meal: 'lunch', name: id, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: updatedAt, updatedAt,
})
const byKey = <T extends { key: string }>(items: T[]) => [...items].sort((a, b) => a.key.localeCompare(b.key))

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('local change queue', () => {
  it('queues a save with the record updatedAt as the change time', async () => {
    await saveEntry(entry('a', '2026-09-30T10:00:00.000Z'))
    expect(await getPendingChanges()).toEqual([
      { key: 'entries:a', store: 'entries', id: 'a', deleted: false, clientUpdatedAt: '2026-09-30T10:00:00.000Z' },
    ])
  })

  it('keeps one change per record, the latest', async () => {
    await saveEntry(entry('a', '2020-01-01T10:00:00.000Z'))
    await saveEntry(entry('a', '2020-01-01T11:00:00.000Z'))
    await deleteEntry('a')
    const [change] = await getPendingChanges()
    expect(await getPendingChanges()).toHaveLength(1)
    expect(change).toMatchObject({ key: 'entries:a', deleted: true })
    expect(change.clientUpdatedAt > '2020-01-01T11:00:00.000Z').toBe(true)
  })

  it('queues a weight save; weights now carry updatedAt', async () => {
    const weight: WeightEntry = { id: 'w', date: '2026-09-30', weight: 80, unit: 'kg', createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z' }
    await saveWeight(weight)
    expect((await getPendingChanges())[0]).toMatchObject({ key: 'weights:w', clientUpdatedAt: '2026-09-30T09:00:00.000Z' })
  })

  it('queues every entry of a batch save', async () => {
    await saveEntries([entry('a', '2026-09-30T10:00:00.000Z'), entry('b', '2026-09-30T10:00:00.000Z')])
    expect(byKey(await getPendingChanges()).map((change) => change.key)).toEqual(['entries:a', 'entries:b'])
  })

  it('records neither the data nor the change when the write fails', async () => {
    const realPut = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'outbox') throw new DOMException('Simulated failure', 'InvalidStateError')
      return realPut.apply(this, args)
    })
    await expect(saveEntry(entry('a', '2026-09-30T10:00:00.000Z'))).rejects.toBeTruthy()
    vi.restoreAllMocks()
    expect(await getEntries()).toEqual([])
    expect(await getPendingChanges()).toEqual([])
  })
})

describe('acknowledging pushed changes', () => {
  it('drops acknowledged changes', async () => {
    await saveEntry(entry('a', '2026-09-30T10:00:00.000Z'))
    await acknowledgeChanges(await getPendingChanges())
    expect(await getPendingChanges()).toEqual([])
  })

  it('keeps a change that was replaced while the push was in flight', async () => {
    await saveEntry(entry('a', '2026-09-30T10:00:00.000Z'))
    const pushed = await getPendingChanges()
    await saveEntry(entry('a', '2026-09-30T11:00:00.000Z'))
    await acknowledgeChanges(pushed)
    expect(await getPendingChanges()).toMatchObject([{ key: 'entries:a', clientUpdatedAt: '2026-09-30T11:00:00.000Z' }])
  })

  it('keeps a delete made while an earlier save was being pushed', async () => {
    await saveEntry(entry('a', '2026-09-30T10:00:00.000Z'))
    const pushed = await getPendingChanges()
    await deleteEntry('a')
    await acknowledgeChanges(pushed)
    expect(await getPendingChanges()).toMatchObject([{ key: 'entries:a', deleted: true }])
  })
})

describe('restore and clear', () => {
  it('queues every restored record but never a cloud delete', async () => {
    await saveEntry(entry('only-local', '2026-09-30T10:00:00.000Z'))
    await acknowledgeChanges(await getPendingChanges())
    const backup = fixture()
    await importBackup(backup)
    const changes = await getPendingChanges()
    expect(changes).toHaveLength(backup.entries.length + backup.foods.length + backup.weights.length + backup.settings.length)
    expect(changes.every((change) => !change.deleted)).toBe(true)
  })

  it('clears the queue with local data, without queueing deletes', async () => {
    await saveEntry(entry('a', '2026-09-30T10:00:00.000Z'))
    await clearAllData()
    expect(await getPendingChanges()).toEqual([])
  })
})
