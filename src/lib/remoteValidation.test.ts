// applyRemoteChanges must not let one malformed cloud row into the local database.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import { applyRemoteChanges, closeDatabase, getEntries, getFoods, getWeights, type RemoteChange } from './db'

const T = '2020-01-01T10:00:00.000Z'
const entry = (id: string, extra: Record<string, unknown> = {}): DiaryEntry => ({
  id, date: '2026-09-30', meal: 'lunch', name: id, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: T, updatedAt: T, ...extra,
} as DiaryEntry)
const change = (id: string, data: unknown, extra: Partial<RemoteChange> = {}): RemoteChange =>
  ({ store: 'entries', id, data: data as Record<string, unknown>, deleted: false, client_updated_at: T, server_updated_at: 'x', ...extra })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(async () => {
  await closeDatabase()
  vi.unstubAllGlobals()
})

describe('applying cloud changes that may be malformed', () => {
  const { updatedAt: _omit, ...noUpdatedAt } = entry('bad')
  it.each([
    ['a missing updatedAt', 'bad', noUpdatedAt],
    ['a bad date', 'bad', entry('bad', { date: '2026-13-45' })],
    ['an id that differs from the row id', 'bad', entry('someone-else')],
    ['negative calories', 'bad', entry('bad', { calories: -5 })],
  ])('skips a row with %s and still applies valid rows in the same batch', async (_name, id, data) => {
    const applied = await applyRemoteChanges([change('good1', entry('good1')), change(id, data), change('good2', entry('good2'))])
    expect(applied).toBe(2)
    expect((await getEntries()).map((e) => e.id).sort()).toEqual(['good1', 'good2'])
  })

  it('skips a row for an unknown store, counting only the applied ones', async () => {
    const applied = await applyRemoteChanges([change('x', { id: 'x' }, { store: 'mystery' as never }), change('good', entry('good'))])
    expect(applied).toBe(1)
    expect((await getEntries()).map((e) => e.id)).toEqual(['good'])
  })

  it('returns 0 and stores nothing when every row is malformed', async () => {
    expect(await applyRemoteChanges([change('a', entry('b')), change('c', { id: 'c' })])).toBe(0)
    expect(await getEntries()).toEqual([])
  })

  it('applies a record with extra unknown fields unchanged', async () => {
    const data = entry('e1', { sodium: 420, fromFuture: { deep: [1, 2] } })
    expect(await applyRemoteChanges([change('e1', data)])).toBe(1)
    expect(await getEntries()).toEqual([data])
  })

  it('applies a tombstone without validating it, even with no data', async () => {
    await applyRemoteChanges([change('e1', entry('e1'))])
    const applied = await applyRemoteChanges([change('e1', null, { deleted: true, client_updated_at: '2020-01-02T00:00:00.000Z' })])
    expect(applied).toBe(1)
    expect(await getEntries()).toEqual([])
  })

  it('validates against the row store, so an entry shaped record in foods is skipped', async () => {
    expect(await applyRemoteChanges([change('e1', entry('e1'), { store: 'foods' })])).toBe(0)
    expect(await getFoods()).toEqual([])
  })
})

describe('applying cloud rows whose fields have the wrong type', () => {
  const weight = (id: string, extra: Record<string, unknown> = {}): WeightEntry =>
    ({ id, date: '2026-09-30', weight: 180, unit: 'lb', createdAt: T, ...extra } as WeightEntry)

  it('skips a weights row whose note is an object and still applies valid siblings', async () => {
    const applied = await applyRemoteChanges([
      change('w1', weight('w1', { note: 'ok' }), { store: 'weights' }),
      change('w2', weight('w2', { note: { evil: 1 } }), { store: 'weights' }),
      change('w3', weight('w3'), { store: 'weights' }),
    ])
    expect(applied).toBe(2)
    expect((await getWeights()).map((w) => w.id).sort()).toEqual(['w1', 'w3'])
  })

  it('skips an entry whose meal is an array and still applies valid siblings', async () => {
    const applied = await applyRemoteChanges([change('good1', entry('good1')), change('bad', entry('bad', { meal: ['lunch'] })), change('good2', entry('good2'))])
    expect(applied).toBe(2)
    expect((await getEntries()).map((e) => e.id).sort()).toEqual(['good1', 'good2'])
  })
})
