import { describe, expect, it } from 'vitest'
import { BACKUP_VERSION, validateBackup } from './backup'

const stamp = '2026-01-01T00:00:00.000Z'
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', date: '2026-02-01', meal: 'lunch', name: 'Soup', calories: 100, protein: 5, carbs: 10, fat: 2,
  createdAt: stamp, updatedAt: stamp, ...over,
})
const food = (over: Record<string, unknown> = {}) => ({
  id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3,
  createdAt: stamp, updatedAt: stamp, ...over,
})
const weight = (over: Record<string, unknown> = {}) => ({ id: 'w1', date: '2026-02-01', weight: 180, unit: 'lb', createdAt: stamp, ...over })
const settings = (over: Record<string, unknown> = {}) => ({ id: 'profile', goals: { calories: 2000, weightUnit: 'kg' }, updatedAt: stamp, ...over })
const backup = (over: Record<string, unknown> = {}) => ({
  format: 'nutrienttrack-backup', version: BACKUP_VERSION, exportedAt: stamp, entries: [], foods: [], weights: [], settings: [], water: [], measurements: [], ...over,
})

describe('validateBackup accepts', () => {
  it('a minimal backup with empty arrays', () => {
    expect(validateBackup(backup())).toBe(true)
  })

  it('a full backup with every optional field populated', () => {
    expect(validateBackup(backup({
      entries: [entry({ time: '23:59', grams: 0, foodId: 'f1', catalogId: 'c1', catalogSource: 'USDA Foundation' }), entry({ id: 'e2', time: '00:00', catalogSource: 'USDA SR Legacy' })],
      foods: [food()],
      weights: [weight({ note: 'ok' })],
      settings: [settings()],
    }))).toBe(true)
  })

  it('records with optional fields absent, and goals with no numeric targets', () => {
    expect(validateBackup(backup({ entries: [entry()], settings: [settings({ goals: { weightUnit: 'lb' } })] }))).toBe(true)
  })

  it('zero calories and a leap day', () => {
    expect(validateBackup(backup({ entries: [entry({ calories: 0, date: '2028-02-29' })] }))).toBe(true)
  })
})

describe('validateBackup rejects', () => {
  it.each([
    ['null', null],
    ['a string', 'backup'],
    ['a number', 5],
    ['an array', []],
  ])('non-object input: %s', (_name, value) => {
    expect(validateBackup(value)).toBe(false)
  })

  it('a wrong format', () => expect(validateBackup(backup({ format: 'other' }))).toBe(false))
  it('a version this build does not know', () => expect(validateBackup(backup({ version: BACKUP_VERSION + 1 }))).toBe(false))
  it('version 1, which must be upgraded by readBackup first', () => expect(validateBackup(backup({ version: 1 }))).toBe(false))
  it.each(['entries', 'foods', 'weights', 'settings', 'water', 'measurements'])('a missing %s array', (key) => {
    const value = backup() as Record<string, unknown>
    delete value[key]
    expect(validateBackup(value)).toBe(false)
  })
  it('an array field that is not an array', () => expect(validateBackup(backup({ entries: {} }))).toBe(false))

  it('duplicate entry ids', () => expect(validateBackup(backup({ entries: [entry(), entry()] }))).toBe(false))
  it('duplicate food ids', () => expect(validateBackup(backup({ foods: [food(), food()] }))).toBe(false))
  it('duplicate weight ids', () => expect(validateBackup(backup({ weights: [weight(), weight()] }))).toBe(false))
  it('an empty id', () => expect(validateBackup(backup({ entries: [entry({ id: '' })] }))).toBe(false))
  it('a whitespace-only id', () => expect(validateBackup(backup({ foods: [food({ id: '  ' })] }))).toBe(false))
  it('a missing id', () => expect(validateBackup(backup({ weights: [weight({ id: undefined })] }))).toBe(false))

  it('an impossible date (2026-02-30)', () => expect(validateBackup(backup({ entries: [entry({ date: '2026-02-30' })] }))).toBe(false))
  it('a non-leap Feb 29', () => expect(validateBackup(backup({ entries: [entry({ date: '2026-02-29' })] }))).toBe(false))
  it('a malformed date string', () => expect(validateBackup(backup({ weights: [weight({ date: '2026-2-1' })] }))).toBe(false))
  it('an invalid weight date', () => expect(validateBackup(backup({ weights: [weight({ date: '2026-13-01' })] }))).toBe(false))

  it('a bad meal', () => expect(validateBackup(backup({ entries: [entry({ meal: 'brunch' })] }))).toBe(false))
  it('negative calories', () => expect(validateBackup(backup({ entries: [entry({ calories: -1 })] }))).toBe(false))
  it('numeric strings for calories', () => expect(validateBackup(backup({ entries: [entry({ calories: '100' })] }))).toBe(false))
  it('NaN macros', () => expect(validateBackup(backup({ foods: [food({ protein: NaN })] }))).toBe(false))
  it('negative grams', () => expect(validateBackup(backup({ entries: [entry({ grams: -5 })] }))).toBe(false))
  it('an empty foodId when present', () => expect(validateBackup(backup({ entries: [entry({ foodId: '' })] }))).toBe(false))
  it('time 24:00', () => expect(validateBackup(backup({ entries: [entry({ time: '24:00' })] }))).toBe(false))
  it('time with bad minutes', () => expect(validateBackup(backup({ entries: [entry({ time: '12:60' })] }))).toBe(false))
  it('a bad catalogSource', () => expect(validateBackup(backup({ entries: [entry({ catalogSource: 'Other' })] }))).toBe(false))
  it('a food with negative fat', () => expect(validateBackup(backup({ foods: [food({ fat: -0.1 })] }))).toBe(false))

  it('weight of 0', () => expect(validateBackup(backup({ weights: [weight({ weight: 0 })] }))).toBe(false))
  it('negative weight', () => expect(validateBackup(backup({ weights: [weight({ weight: -3 })] }))).toBe(false))
  it('non-finite weight', () => expect(validateBackup(backup({ weights: [weight({ weight: Infinity })] }))).toBe(false))
  it('a bad unit', () => expect(validateBackup(backup({ weights: [weight({ unit: 'stone' })] }))).toBe(false))

  it('more than one settings record', () => {
    expect(validateBackup(backup({ settings: [settings(), settings({ id: 'other' })] }))).toBe(false)
  })
  it('a settings id other than profile', () => expect(validateBackup(backup({ settings: [settings({ id: 'main' })] }))).toBe(false))
  it('goals with a negative value', () => {
    expect(validateBackup(backup({ settings: [settings({ goals: { protein: -1, weightUnit: 'lb' } })] }))).toBe(false)
  })
  it('goals with a bad weightUnit', () => {
    expect(validateBackup(backup({ settings: [settings({ goals: { weightUnit: 'st' } })] }))).toBe(false)
  })
  it('goals that are missing', () => expect(validateBackup(backup({ settings: [settings({ goals: undefined })] }))).toBe(false))
})
