// Micronutrient fields are optional everywhere: no version bump, old backups still restore, unknown fields survive (invariants 1, 2 and 4).
import { describe, expect, it } from 'vitest'
import fixtureV1 from './__fixtures__/backup-v1.json'
import fixtureV2 from './__fixtures__/backup-v2.json'
import fixtureV3 from './__fixtures__/backup-v3.json'
import { BACKUP_VERSION, isValidSyncRecord, readBackup, validateBackup } from './backup'
import { NUTRIENT_KEYS } from './nutrients'

const stamp = '2026-01-01T00:00:00.000Z'
const entry = (over: Record<string, unknown> = {}) => ({ id: 'e1', date: '2026-02-01', meal: 'lunch', name: 'Soup', calories: 100, protein: 5, carbs: 10, fat: 2, createdAt: stamp, updatedAt: stamp, ...over })
const food = (over: Record<string, unknown> = {}) => ({ id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp, ...over })
const backup = (over: Record<string, unknown> = {}) => ({ format: 'nutrienttrack-backup', version: BACKUP_VERSION, exportedAt: stamp, entries: [], foods: [], weights: [], settings: [], water: [], measurements: [], symptoms: [], ...over })
const NEW_KEYS = NUTRIENT_KEYS.slice(5)

describe('old backups still restore with micronutrient support', () => {
  it.each([['v1', fixtureV1], ['v2', fixtureV2], ['v3', fixtureV3]])('the frozen %s fixture is read, at the current version, with no nutrient keys invented', (_name, fixture) => {
    const result = readBackup(structuredClone(fixture))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.version).toBe(BACKUP_VERSION)
    expect(BACKUP_VERSION).toBe(3)
    for (const record of [...result.backup.entries, ...result.backup.foods] as unknown as Array<Record<string, unknown>>) {
      for (const key of NEW_KEYS) expect(record).not.toHaveProperty(key)
    }
  })

  it('does not bump the backup version for new optional fields', () => {
    expect(readBackup(backup({ entries: [entry({ potassium: 358 })] })).ok).toBe(true)
  })
})

describe('micronutrient fields in backups and sync records', () => {
  const all = Object.fromEntries(NUTRIENT_KEYS.map((key, index) => [key, index]))

  it('accepts every nutrient on entries and foods, zero included, and keeps them through readBackup', () => {
    const result = readBackup(backup({ entries: [entry(all)], foods: [food(all)] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.entries[0]).toMatchObject(all)
    expect(result.backup.foods[0]).toMatchObject(all)
  })

  it.each(NEW_KEYS)('rejects a negative or text %s on an entry and on a food', (key) => {
    expect(validateBackup(backup({ entries: [entry({ [key]: -1 })] }))).toBe(false)
    expect(validateBackup(backup({ entries: [entry({ [key]: '5' })] }))).toBe(false)
    expect(validateBackup(backup({ foods: [food({ [key]: -0.1 })] }))).toBe(false)
  })

  it('keeps nutrient fields this build does not know, on entries and foods', () => {
    const result = readBackup(backup({ entries: [entry({ potassium: 1, lutein: 9, newerThing: { a: 1 } })], foods: [food({ lycopene: 4 })] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.entries[0]).toMatchObject({ potassium: 1, lutein: 9, newerThing: { a: 1 } })
    expect(result.backup.foods[0]).toMatchObject({ lycopene: 4 })
  })

  it('validates synced records the same way', () => {
    expect(isValidSyncRecord('entries', entry(all), 'e1')).toBe(true)
    expect(isValidSyncRecord('entries', entry({ vitaminD: -3 }), 'e1')).toBe(false)
    expect(isValidSyncRecord('foods', food({ omega3: 1.2 }), 'f1')).toBe(true)
    expect(isValidSyncRecord('foods', food({ omega3: Number.NaN }), 'f1')).toBe(false)
  })
})
