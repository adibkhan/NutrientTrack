// Multi-tab safety and the sync outbox. Runs the real db.ts on fake-indexeddb.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupPayload, DiaryEntry, Settings } from '../types'
import fixtureV1 from './__fixtures__/backup-v1.json'
import {
  clearAllData, closeDatabase, deleteEntry, getEntries, getMeta, getPendingChanges, getSettings, importBackup, onLocalChange,
  saveEntry, saveSettings, saveWaterLog, saveFood, saveWeight, RecordMissingError, type RemoteChange,
} from './db'
import { syncOnce, type OutgoingChange, type SyncBackend } from './sync'

const stamp = '2026-09-30T10:00:00.000Z'
const entry = (id: string): DiaryEntry => ({ id, date: '2026-09-30', meal: 'lunch', name: id, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp })
const settings = (patch: Partial<Settings> = {}): Settings => ({ id: 'profile', goals: { weightUnit: 'lb' }, updatedAt: stamp, ...patch })

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => {
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('saveSettings from a stale tab', () => {
  it('applies only its own changed fields onto the stored record', async () => {
    const original = settings({ goals: { weightUnit: 'lb', calories: 2000 }, preferences: { theme: 'light' } })
    await saveSettings(original)
    // Tab B (opened earlier, still holding `original`) changes the calorie goal; tab A already changed the theme and added reminders.
    await saveSettings({ ...original, preferences: { theme: 'dark', barcodeLookup: true }, updatedAt: '2026-09-30T11:00:00.000Z' })
    const saved = await saveSettings({ ...original, goals: { weightUnit: 'lb', calories: 2400 }, updatedAt: '2026-09-30T12:00:00.000Z' }, original)

    const stored = await getSettings()
    expect(stored?.goals.calories).toBe(2400)
    expect(stored?.preferences).toEqual({ theme: 'dark', barcodeLookup: true })
    expect(stored?.updatedAt).toBe('2026-09-30T12:00:00.000Z')
    expect(saved).toEqual(stored)
  })

  it('merges inside nested objects and keeps unknown fields written by a newer build', async () => {
    const original = settings({ preferences: { theme: 'light' } })
    await saveSettings({ ...original, futureField: { a: 1 }, preferences: { theme: 'light', reminders: { enabled: true } } } as unknown as Settings)
    await saveSettings({ ...original, preferences: { theme: 'dark' } }, original)
    const stored = (await getSettings()) as unknown as Record<string, unknown>
    expect(stored.futureField).toEqual({ a: 1 })
    expect(stored.preferences).toEqual({ theme: 'dark', reminders: { enabled: true } })
  })

  it('creates the record when none is stored, and treats null as "had nothing"', async () => {
    await saveSettings(settings({ goals: { weightUnit: 'kg', calories: 1800 } }), null)
    expect((await getSettings())?.goals).toEqual({ weightUnit: 'kg', calories: 1800 })
  })

  it('still replaces the record as given when no previous snapshot is passed', async () => {
    await saveSettings(settings({ goals: { weightUnit: 'lb', calories: 2000 } }))
    await saveSettings(settings({ goals: { weightUnit: 'kg' } }))
    expect((await getSettings())?.goals).toEqual({ weightUnit: 'kg' })
  })
})

describe('editing an entry another tab deleted', () => {
  it('does not recreate it, and says why', async () => {
    await saveEntry(entry('a'))
    await deleteEntry('a')
    await expect(saveEntry({ ...entry('a'), name: 'edited' }, { mustExist: true })).rejects.toBeInstanceOf(RecordMissingError)
    expect(await getEntries()).toEqual([])
  })

  it('saves an edit of an entry that still exists, and plain saves still create', async () => {
    await saveEntry(entry('a'))
    await saveEntry({ ...entry('a'), name: 'edited' }, { mustExist: true })
    await saveEntry(entry('b'))
    expect((await getEntries()).map((item) => item.name).sort()).toEqual(['b', 'edited'])
  })
})

describe('cross-tab change messages', () => {
  it('posts after a committed write and fires onLocalChange with source remote on the receiving side', async () => {
    const other = new BroadcastChannel('nutrienttrack-local')
    const heard = vi.fn()
    other.addEventListener('message', heard)
    await saveWaterLog({ id: '2026-09-30', date: '2026-09-30', ml: 250, createdAt: stamp, updatedAt: stamp } as never)
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))

    const sources: string[] = []
    const unsubscribe = onLocalChange((source) => sources.push(source))
    other.postMessage('changed')
    await vi.waitFor(() => expect(sources).toContain('remote'))
    unsubscribe()
    other.close()
  })

  it('does not post for sync bookkeeping alone', async () => {
    const other = new BroadcastChannel('nutrienttrack-local')
    const heard = vi.fn()
    other.addEventListener('message', heard)
    await getEntries()
    await getMeta('x')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(heard).not.toHaveBeenCalled()
    other.close()
  })

  it('works without BroadcastChannel', async () => {
    await closeDatabase()
    vi.stubGlobal('BroadcastChannel', undefined)
    await expect(saveEntry(entry('a'))).resolves.toBeUndefined()
    const unsubscribe = onLocalChange(() => undefined)
    unsubscribe()
  })
})

describe('the outbox for a device that never used sync', () => {
  const food = { id: 'f', name: 'Soup', serving: '1 bowl', calories: 1, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp }

  it('queues nothing for saves, but the data is stored', async () => {
    await saveEntry(entry('a'))
    await saveFood(food)
    await saveWeight({ id: 'w', date: '2026-09-30', weight: 80, unit: 'kg', createdAt: stamp, updatedAt: stamp })
    await saveSettings(settings())
    await saveSettings(settings({ goals: { weightUnit: 'kg' } }), settings())
    expect(await getPendingChanges()).toEqual([])
    expect(await getEntries()).toHaveLength(1)
  })

  it('queues saves once sync has been used', async () => {
    const { setMeta } = await import('./db')
    await setMeta('everSynced', true)
    await saveEntry(entry('a'))
    await saveSettings(settings({ goals: { weightUnit: 'kg' } }), settings())
    expect((await getPendingChanges()).map((change) => change.key).sort()).toEqual(['entries:a', 'settings:profile'])
  })

  it('queues nothing on restore, and clear still empties everything', async () => {
    await importBackup(structuredClone(fixtureV1) as unknown as BackupPayload)
    expect((await getEntries()).length).toBeGreaterThan(0)
    expect(await getPendingChanges()).toEqual([])
    await clearAllData()
  })

  it('queues restored records once sync has been used', async () => {
    const { setMeta } = await import('./db')
    await setMeta('everSynced', true)
    await importBackup(structuredClone(fixtureV1) as unknown as BackupPayload)
    expect((await getPendingChanges()).length).toBeGreaterThan(0)
  })

  it('uploads every local record on first sign-in even though nothing was queued', async () => {
    await saveEntry(entry('a'))
    await saveEntry(entry('b'))
    await saveFood(food)
    await saveSettings(settings())
    expect(await getPendingChanges()).toEqual([])

    const pushed: OutgoingChange[] = []
    const backend: SyncBackend = {
      push: async (changes) => { pushed.push(...changes) },
      pull: async (): Promise<RemoteChange[]> => [],
    }
    await syncOnce(backend, 'user-1')
    expect(pushed.map((change) => `${change.store}:${change.id}`).sort()).toEqual(['entries:a', 'entries:b', 'foods:f', 'settings:profile'])
    expect(await getMeta('everSynced')).toBe(true)
    expect(await getPendingChanges()).toEqual([])
  })
})
