// deleteEntries: delete a group of diary entries (Undo for bulk adds) in one transaction. Runs the real db.ts on fake-indexeddb.
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from '../types'
import { closeDatabase, deleteEntries, getEntries, getPendingChanges, saveEntries, setMeta } from './db'

const entry = (id: string): DiaryEntry => ({
  id, date: '2026-09-30', meal: 'lunch', name: id, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: '2026-09-30T10:00:00.000Z', updatedAt: '2026-09-30T10:00:00.000Z',
})
const ids = async () => (await getEntries()).map((item) => item.id).sort()

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => {
  vi.restoreAllMocks()
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('deleteEntries', () => {
  it('deletes only the listed entries and queues one delete marker each once sync has been used', async () => {
    await setMeta('everSynced', true)
    await saveEntries([entry('a'), entry('b'), entry('c'), entry('keep')])
    await deleteEntries(['a', 'b', 'c'])
    expect(await ids()).toEqual(['keep'])
    const pending = (await getPendingChanges()).sort((x, y) => x.key.localeCompare(y.key))
    expect(pending.filter((change) => change.deleted).map((change) => change.key)).toEqual(['entries:a', 'entries:b', 'entries:c'])
    expect(pending.find((change) => change.key === 'entries:keep')?.deleted).toBe(false)
  })

  it('leaves no outbox rows on a device that never synced, and drops stale queued saves', async () => {
    await setMeta('everSynced', true)
    await saveEntries([entry('a'), entry('b')])
    expect(await getPendingChanges()).toHaveLength(2)
    await setMeta('everSynced', undefined)
    await deleteEntries(['a', 'b'])
    expect(await ids()).toEqual([])
    expect(await getPendingChanges()).toEqual([])
  })

  it('ignores duplicate ids and an empty list', async () => {
    await saveEntries([entry('a'), entry('b')])
    await deleteEntries([])
    await deleteEntries(['a', 'a'])
    expect(await ids()).toEqual(['b'])
  })

  it('keeps every entry and the outbox untouched when the transaction fails part way', async () => {
    await setMeta('everSynced', true)
    await saveEntries([entry('a'), entry('b'), entry('c')])
    const before = (await getPendingChanges()).sort((x, y) => x.key.localeCompare(y.key))
    const realDelete = IDBObjectStore.prototype.delete
    let calls = 0
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
      calls += 1
      if (calls === 2) throw new DOMException('Simulated failure', 'InvalidStateError')
      return realDelete.apply(this, args)
    })
    await expect(deleteEntries(['a', 'b', 'c'])).rejects.toBeTruthy()
    vi.restoreAllMocks()
    expect(await ids()).toEqual(['a', 'b', 'c'])
    expect((await getPendingChanges()).sort((x, y) => x.key.localeCompare(y.key))).toEqual(before)
  })

  it('posts the cross-tab message after it commits', async () => {
    const other = new BroadcastChannel('nutrienttrack-local')
    const heard = vi.fn()
    other.addEventListener('message', heard)
    await saveEntries([entry('a')])
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    await deleteEntries(['a'])
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(2))
    other.close()
  })
})
