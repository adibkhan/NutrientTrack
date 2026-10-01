// Fixtures in ./__fixtures__ are frozen (see README.md there). Never edit them; add a new version instead.
import { describe, expect, it } from 'vitest'
import { BACKUP_VERSION, isValidSyncRecord, readBackup } from './backup'
import fixtureV1 from './__fixtures__/backup-v1.json'

const fixture = () => structuredClone(fixtureV1) as unknown as Record<string, unknown>

describe('readBackup with the frozen v1 fixture', () => {
  it('accepts the v1 fixture and returns it at the current version', () => {
    const result = readBackup(fixture())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.backup.version).toBe(BACKUP_VERSION)
      expect(result.backup.entries).toHaveLength(3)
      expect(result.backup.weights.map((w) => w.unit)).toEqual(['lb', 'lb', 'kg', 'kg'])
    }
  })

  it('preserves unknown fields on entries and settings', () => {
    const result = readBackup(fixture())
    if (!result.ok) throw new Error('fixture rejected')
    expect((result.backup.entries[2] as unknown as Record<string, unknown>).sodium).toBe(120)
    expect((result.backup.settings[0] as unknown as Record<string, unknown>).theme).toBe('dark')
  })

  it('reports a version 2 backup as newer, not invalid', () => {
    expect(readBackup({ ...fixture(), version: 2 })).toEqual({ ok: false, reason: 'newer' })
  })

  it.each([
    ['zero', 0],
    ['a numeric string', '1'],
    ['a fraction', 1.5],
    ['negative', -1],
    ['NaN', NaN],
    ['missing', undefined],
  ])('reports version %s as invalid', (_name, version) => {
    expect(readBackup({ ...fixture(), version })).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([null, 'text', 5, []])('reports non-object input %j as invalid', (value) => {
    expect(readBackup(value)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports a current-version file with a corrupt record as invalid', () => {
    const broken = fixture()
    ;(broken.entries as Array<Record<string, unknown>>)[0].calories = -1
    expect(readBackup(broken)).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('isValidSyncRecord with the frozen v1 fixture records', () => {
  const stores = ['entries', 'foods', 'weights', 'settings'] as const
  const list = (store: (typeof stores)[number]) => fixture()[store] as Array<Record<string, unknown>>

  it.each(stores)('accepts every fixture record of %s', (store) => {
    expect(list(store).length).toBeGreaterThan(0)
    for (const record of list(store)) expect(isValidSyncRecord(store, record, record.id as string)).toBe(true)
  })

  it('accepts a record with extra unknown fields', () => {
    const entry: Record<string, unknown> = { ...list('entries')[1], fiberFromFutureBuild: 3, nested: { a: 1 } }
    expect(isValidSyncRecord('entries', entry, entry.id as string)).toBe(true)
  })

  it('rejects a record whose id differs from the cloud row id', () => {
    expect(isValidSyncRecord('entries', list('entries')[0], 'some-other-id')).toBe(false)
  })

  it('rejects a settings record whose id is not profile', () => {
    const settings = { ...list('settings')[0], id: 'other' }
    expect(isValidSyncRecord('settings', settings, 'other')).toBe(false)
  })

  it.each([null, undefined, 'text', 5, []])('rejects non-object data %j', (data) => {
    expect(isValidSyncRecord('entries', data, 'x')).toBe(false)
  })

  it('rejects a record that is valid for another store', () => {
    const entry = list('entries')[0]
    expect(isValidSyncRecord('foods', entry, entry.id as string)).toBe(false)
  })

  it('rejects negative calories and a missing updatedAt', () => {
    const entry = list('entries')[0]
    expect(isValidSyncRecord('entries', { ...entry, calories: -1 }, entry.id as string)).toBe(false)
    const { updatedAt: _omit, ...withoutUpdatedAt } = entry
    expect(isValidSyncRecord('entries', withoutUpdatedAt, entry.id as string)).toBe(false)
  })
})
