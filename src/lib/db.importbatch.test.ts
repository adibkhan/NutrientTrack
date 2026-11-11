// saveWeights and saveEntriesAndWeights: batch saves for imports. Run the real db.ts on fake-indexeddb.
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import { closeDatabase, getEntries, getPendingChanges, getWeights, saveEntriesAndWeights, saveWeights, setMeta } from './db'

const stamp = '2026-09-30T10:00:00.000Z'
const entry = (id: string): DiaryEntry => ({ id, date: '2026-09-30', meal: 'lunch', name: id, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp })
const weight = (id: string): WeightEntry => ({ id, date: '2026-09-30', weight: 80, unit: 'kg', createdAt: stamp, updatedAt: stamp })

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => {
  vi.restoreAllMocks()
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('saveWeights', () => {
  it('saves a group of weigh-ins and queues them only once sync has been used', async () => {
    await saveWeights([weight('w1'), weight('w2')])
    expect((await getWeights()).map((item) => item.id).sort()).toEqual(['w1', 'w2'])
    expect(await getPendingChanges()).toEqual([])
    await setMeta('everSynced', true)
    await saveWeights([weight('w3')])
    expect((await getPendingChanges()).map((change) => change.key)).toEqual(['weights:w3'])
    await saveWeights([])
  })
})

describe('saveEntriesAndWeights', () => {
  it('writes both stores in one go and queues every record once sync has been used', async () => {
    await setMeta('everSynced', true)
    await saveEntriesAndWeights([entry('a'), entry('b')], [weight('w')])
    expect((await getEntries()).map((item) => item.id).sort()).toEqual(['a', 'b'])
    expect((await getWeights()).map((item) => item.id)).toEqual(['w'])
    expect((await getPendingChanges()).map((change) => change.key).sort()).toEqual(['entries:a', 'entries:b', 'weights:w'])
  })

  it('queues nothing on a device that never synced', async () => {
    await saveEntriesAndWeights([entry('a')], [weight('w')])
    expect(await getEntries()).toHaveLength(1)
    expect(await getPendingChanges()).toEqual([])
  })

  it('saves neither store when a weigh-in is rejected after the entries were queued', async () => {
    await setMeta('everSynced', true)
    const realPut = IDBObjectStore.prototype.put
    let calls = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1
      if (calls === 3) throw new DOMException('Simulated failure', 'InvalidStateError')
      return realPut.apply(this, args)
    })
    await expect(saveEntriesAndWeights([entry('a'), entry('b')], [weight('w')])).rejects.toBeTruthy()
    vi.restoreAllMocks()
    expect(await getEntries()).toEqual([])
    expect(await getWeights()).toEqual([])
    expect(await getPendingChanges()).toEqual([])
  })
})

describe('saveEntriesAndWeights replacing entries', () => {
  it('deletes_the_replaced_entries_in_the_same_transaction_and_queues_delete_markers', async () => {
    await saveEntriesAndWeights([entry('old')], [])
    await setMeta('everSynced', true)
    await saveEntriesAndWeights([entry('new1'), entry('new2')], [], ['old'])
    expect((await getEntries()).map((item) => item.id).sort()).toEqual(['new1', 'new2'])
    const pending = (await getPendingChanges()).sort((a, b) => a.key.localeCompare(b.key))
    expect(pending.map((change) => [change.key, change.deleted])).toEqual([['entries:new1', false], ['entries:new2', false], ['entries:old', true]])
  })
  it('keeps_the_old_entry_when_the_save_fails_part_way', async () => {
    await saveEntriesAndWeights([entry('old')], [])
    const realPut = IDBObjectStore.prototype.put
    let calls = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1
      if (calls === 2) throw new DOMException('Simulated failure', 'InvalidStateError')
      return realPut.apply(this, args)
    })
    await expect(saveEntriesAndWeights([entry('a'), entry('b')], [], ['old'])).rejects.toBeTruthy()
    vi.restoreAllMocks()
    expect((await getEntries()).map((item) => item.id)).toEqual(['old'])
  })
  it('queues_no_delete_marker_on_a_device_that_never_synced', async () => {
    await saveEntriesAndWeights([entry('old')], [])
    await saveEntriesAndWeights([entry('new')], [], ['old'])
    expect(await getPendingChanges()).toEqual([])
  })
})
