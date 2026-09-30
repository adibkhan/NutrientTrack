// Cloud sync end to end: the real db.ts and sync.ts on fake-indexeddb, against an in-memory stand-in for
// supabase/migrations/0001_sync_records.sql. Each "device" is its own IndexedDB factory.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import {
  acknowledgeChanges, applyRemoteChanges, closeDatabase, deleteEntry, exportBackup, getEntries, getMeta, getPendingChanges, getWeights,
  importBackup, saveEntry, saveWeight, type RemoteChange,
} from './db'
import { syncOnce, type OutgoingChange, type SyncBackend } from './sync'

interface Row extends RemoteChange { user: string }

/** Mirrors sync_records: keyed (user, store, id), stale writes ignored, deletes null the data, server clock strictly increasing. */
class FakeBackend implements SyncBackend {
  rows = new Map<string, Row>()
  pullSinces: Array<string | undefined> = []
  pushCalls = 0
  failNextPush = false
  onPush?: () => Promise<void>
  private tick = 0
  constructor(private user = 'user-1', private stepMs = 1000) {}

  private stamp() {
    this.tick += 1
    const base = Date.UTC(2026, 8, 30, 12, 0, 0) + this.tick * this.stepMs
    const iso = new Date(base).toISOString() // ...sss.mmmZ
    return `${iso.slice(0, 23)}${String(this.tick % 1000).padStart(3, '0')}+00:00`
  }

  async push(changes: OutgoingChange[]) {
    this.pushCalls += 1
    if (this.failNextPush) { this.failNextPush = false; throw new Error('network down') }
    await this.onPush?.()
    for (const change of changes) {
      const key = `${this.user}|${change.store}|${change.id}`
      const existing = this.rows.get(key)
      if (existing && new Date(change.client_updated_at) < new Date(existing.client_updated_at)) continue
      this.rows.set(key, {
        user: this.user, store: change.store, id: change.id, deleted: change.deleted,
        data: change.deleted ? null : structuredClone(change.data), client_updated_at: change.client_updated_at,
        server_updated_at: this.stamp(),
      })
    }
  }

  async pull(since: string | undefined, limit: number) {
    this.pullSinces.push(since)
    const micros = (value: string) => {
      const [, head, fraction = ''] = /^(.*?:\d\d)(?:\.(\d+))?(?:Z|[+-]00:00)$/.exec(value) ?? []
      return BigInt(Date.parse(`${head}Z`)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(0, 6))
    }
    return [...this.rows.values()]
      .filter((row) => row.user === this.user && (since === undefined || micros(row.server_updated_at) > micros(since)))
      .sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1))
      .slice(0, limit)
      .map(({ user: _user, ...row }) => structuredClone(row) as RemoteChange)
  }
}

const devices: Record<string, IDBFactory> = {}
const useDevice = async (name: string) => {
  await closeDatabase()
  devices[name] ??= new IDBFactory()
  vi.stubGlobal('indexedDB', devices[name])
}

const entry = (id: string, updatedAt: string, extra: Record<string, unknown> = {}): DiaryEntry => ({
  id, date: '2026-09-30', meal: 'lunch', name: id, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: '2020-01-01T00:00:00.000Z', updatedAt, ...extra,
} as DiaryEntry)
const weight = (id: string, updatedAt: string): WeightEntry => ({ id, date: '2026-09-30', weight: 80, unit: 'kg', createdAt: updatedAt, updatedAt })
const T = (hour: number) => `2020-01-01T${String(hour).padStart(2, '0')}:00:00.000Z`

beforeEach(() => {
  for (const key of Object.keys(devices)) delete devices[key]
})
afterEach(async () => {
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('first sync on a device with existing data', () => {
  it('queues and pushes everything logged before sync existed, and records the account', async () => {
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await saveEntry(entry('e2', T(2)))
    await saveWeight(weight('w1', T(3)))
    await acknowledgeChanges(await getPendingChanges())
    expect(await getPendingChanges()).toHaveLength(0)

    const backend = new FakeBackend()
    const result = await syncOnce(backend, 'user-1')

    expect(result.pushed).toBe(3)
    expect([...backend.rows.values()].map((row) => `${row.store}:${row.id}`).sort()).toEqual(['entries:e1', 'entries:e2', 'weights:w1'])
    expect(await getMeta('syncUserId')).toBe('user-1')
    expect(await getPendingChanges()).toHaveLength(0)
  })

  it('does nothing on an empty device with an empty cloud', async () => {
    await useDevice('a')
    const backend = new FakeBackend()
    expect(await syncOnce(backend, 'user-1')).toEqual({ pushed: 0, applied: 0 })
    expect(await getMeta('pullCursor')).toBeUndefined()
  })
})

describe('two devices', () => {
  it('carries a field this build does not know about from one device to the other', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1), { sodium: 420 }))
    await syncOnce(backend, 'user-1')

    await useDevice('b')
    const result = await syncOnce(backend, 'user-1')
    expect(result.applied).toBe(1)
    const [pulled] = await getEntries()
    expect(pulled).toEqual(entry('e1', T(1), { sodium: 420 }))
    expect(await getPendingChanges()).toHaveLength(0)
  })

  it('carries an edit from B to A', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await syncOnce(backend, 'user-1')
    await useDevice('b')
    await syncOnce(backend, 'user-1')
    await saveEntry(entry('e1', T(2), { name: 'edited on B' }))
    await syncOnce(backend, 'user-1')

    await useDevice('a')
    expect((await syncOnce(backend, 'user-1')).applied).toBeGreaterThan(0)
    expect((await getEntries())[0]).toMatchObject({ id: 'e1', name: 'edited on B', updatedAt: T(2) })
  })

  it('carries a delete from A to B', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await syncOnce(backend, 'user-1')
    await useDevice('b')
    await syncOnce(backend, 'user-1')
    expect(await getEntries()).toHaveLength(1)

    await useDevice('a')
    await deleteEntry('e1')
    await syncOnce(backend, 'user-1')
    expect([...backend.rows.values()][0]).toMatchObject({ deleted: true, data: null })

    await useDevice('b')
    await syncOnce(backend, 'user-1')
    expect(await getEntries()).toEqual([])
  })

  it.each([
    ['A syncs first', ['a', 'b', 'a', 'b']],
    ['B syncs first', ['b', 'a', 'b', 'a']],
  ])('keeps the later edit on both devices when both edited offline (%s)', async (_label, order) => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await syncOnce(backend, 'user-1')
    await useDevice('b')
    await syncOnce(backend, 'user-1')

    await useDevice('a')
    await saveEntry(entry('e1', T(5), { name: 'from A' }))
    await useDevice('b')
    await saveEntry(entry('e1', T(9), { name: 'from B' }))

    for (const device of order) {
      await useDevice(device)
      await syncOnce(backend, 'user-1')
    }
    for (const device of ['a', 'b']) {
      await useDevice(device)
      expect(await getEntries()).toEqual([entry('e1', T(9), { name: 'from B' })])
      expect(await getPendingChanges()).toHaveLength(0)
    }
    expect([...backend.rows.values()][0].data).toMatchObject({ name: 'from B' })
  })

  it('keeps a newer local change made while a push was in flight, instead of overwriting it with an older remote row', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await syncOnce(backend, 'user-1')
    await useDevice('b')
    await syncOnce(backend, 'user-1')

    await useDevice('a')
    await saveEntry(entry('e1', T(3), { name: 'A edit' }))
    await syncOnce(backend, 'user-1')

    await useDevice('b')
    await saveEntry(entry('e1', T(2), { name: 'B first edit' }))
    backend.onPush = async () => {
      backend.onPush = undefined
      await saveEntry(entry('e1', T(9), { name: 'B edit during push' }))
    }
    await syncOnce(backend, 'user-1')
    expect((await getEntries())[0]).toMatchObject({ name: 'B edit during push', updatedAt: T(9) })
    expect(await getPendingChanges()).toHaveLength(1)

    expect((await syncOnce(backend, 'user-1')).pushed).toBe(1)
    expect(await getPendingChanges()).toHaveLength(0)
    await useDevice('a')
    await syncOnce(backend, 'user-1')
    expect((await getEntries())[0]).toMatchObject({ name: 'B edit during push' })
  })
})

describe('pulling', () => {
  it('pulls more than one page, persists the cursor, and a repeat sync pushes nothing and changes no data', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    const total = 1203
    for (let i = 0; i < total; i += 1) {
      const id = `e${String(i).padStart(4, '0')}`
      const change: OutgoingChange = { store: 'entries', id, data: entry(id, T(1)) as unknown as Record<string, unknown>, deleted: false, client_updated_at: T(1) }
      await backend.push([change])
    }

    await useDevice('b')
    const first = await syncOnce(backend, 'user-1')
    expect(first).toEqual({ pushed: 0, applied: total })
    expect(await getEntries()).toHaveLength(total)
    const lastStamp = [...backend.rows.values()].map((row) => row.server_updated_at).sort().at(-1)
    expect(await getMeta('pullCursor')).toBe(lastStamp)

    backend.pullSinces = []
    const second = await syncOnce(backend, 'user-1')
    expect(second.pushed).toBe(0)
    expect(backend.pullSinces[0]).toBeDefined()
    expect(second.applied).toBeLessThan(20) // only the short overlap window is re-read
    expect(await getEntries()).toHaveLength(total)
    expect(await getPendingChanges()).toHaveLength(0)
  })

  it('pulls exactly one full page (500 rows) without losing the cursor', async () => {
    const backend = new FakeBackend()
    for (let i = 0; i < 500; i += 1) {
      await backend.push([{ store: 'entries', id: `e${i}`, data: entry(`e${i}`, T(1)) as unknown as Record<string, unknown>, deleted: false, client_updated_at: T(1) }])
    }
    await useDevice('b')
    expect((await syncOnce(backend, 'user-1')).applied).toBe(500)
    expect(await getEntries()).toHaveLength(500)
    expect(await getMeta('pullCursor')).toBeDefined()
  })

  it('ignores changes for stores it does not know, and still applies the known ones', async () => {
    await useDevice('a')
    const applied = await applyRemoteChanges([
      { store: 'mystery' as never, id: 'x', data: { id: 'x' }, deleted: false, client_updated_at: T(1), server_updated_at: 'x' },
      { store: 'entries', id: 'e1', data: entry('e1', T(1)) as never, deleted: false, client_updated_at: T(1), server_updated_at: 'x' },
    ])
    expect(applied).toBe(1)
    expect((await getEntries()).map((item) => item.id)).toEqual(['e1'])
    expect(await applyRemoteChanges([{ store: 'mystery' as never, id: 'x', data: null, deleted: true, client_updated_at: T(1), server_updated_at: 'x' }])).toBe(0)
  })
})

describe('failures and accounts', () => {
  it('keeps the outbox and local data when the push fails, then succeeds next time', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await saveEntry(entry('e2', T(2)))
    const before = await getPendingChanges()
    backend.failNextPush = true

    await expect(syncOnce(backend, 'user-1')).rejects.toThrow('network down')
    expect(await getPendingChanges()).toEqual(before)
    expect((await getEntries()).map((item) => item.id).sort()).toEqual(['e1', 'e2'])
    expect(backend.rows.size).toBe(0)

    expect((await syncOnce(backend, 'user-1')).pushed).toBe(2)
    expect(backend.rows.size).toBe(2)
    expect(await getPendingChanges()).toHaveLength(0)
  })

  it('re-queues everything and resets the cursor when a different account signs in', async () => {
    const first = new FakeBackend('user-1')
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await saveEntry(entry('e2', T(2)))
    await syncOnce(first, 'user-1')
    expect(await getMeta('pullCursor')).toBeDefined()

    const second = new FakeBackend('user-2')
    const result = await syncOnce(second, 'user-2')
    expect(result.pushed).toBe(2)
    expect(second.rows.size).toBe(2)
    expect(second.pullSinces[0]).toBeUndefined()
    expect(await getMeta('syncUserId')).toBe('user-2')
  })

  it('does not re-queue records on a repeat sync for the same account', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveEntry(entry('e1', T(1)))
    await syncOnce(backend, 'user-1')
    backend.pushCalls = 0
    expect((await syncOnce(backend, 'user-1')).pushed).toBe(0)
    expect(backend.pushCalls).toBe(0)
  })

  it('syncs weights and deletes of weights', async () => {
    const backend = new FakeBackend()
    await useDevice('a')
    await saveWeight(weight('w1', T(1)))
    await syncOnce(backend, 'user-1')
    await useDevice('b')
    await syncOnce(backend, 'user-1')
    expect(await getWeights()).toHaveLength(1)
  })
})

describe('restoring an older backup while syncing', () => {
  it('makes the restored version the newest everywhere instead of being ignored as stale', async () => {
    const backend = new FakeBackend('user-1', 60_000)
    await useDevice('one')
    await saveEntry(entry('a', T(10), { name: 'Soup' }))
    const backup = await exportBackup()
    await syncOnce(backend, 'user-1')
    await saveEntry(entry('a', T(11), { name: 'Soup edited' }))
    await syncOnce(backend, 'user-1')

    await importBackup(backup)
    await syncOnce(backend, 'user-1')

    expect((await getEntries()).map((e) => e.name)).toEqual(['Soup'])
    expect([...backend.rows.values()].map((row) => (row.data as { name?: string } | null)?.name)).toEqual(['Soup'])
    expect(await getPendingChanges()).toEqual([])

    await useDevice('two')
    await syncOnce(backend, 'user-1')
    expect((await getEntries()).map((e) => e.name)).toEqual(['Soup'])
    // The record's own data is restored exactly, including its original updatedAt.
    expect((await getEntries())[0].updatedAt).toBe(T(10))
  })
})
