// Backup validation for the nutrient, planned, favorite, recipe and body fat fields. Optional everywhere; a missing value is "not recorded".
import { describe, expect, it } from 'vitest'
import { BACKUP_VERSION, isValidSyncRecord, readBackup, validateBackup } from './backup'
import fixtureV1 from './__fixtures__/backup-v1.json'

const stamp = '2026-01-01T00:00:00.000Z'
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', date: '2026-02-01', meal: 'lunch', name: 'Soup', calories: 100, protein: 5, carbs: 10, fat: 2, createdAt: stamp, updatedAt: stamp, ...over,
})
const food = (over: Record<string, unknown> = {}) => ({
  id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp, ...over,
})
const weight = (over: Record<string, unknown> = {}) => ({ id: 'w1', date: '2026-02-01', weight: 180, unit: 'lb', createdAt: stamp, ...over })
const backup = (over: Record<string, unknown> = {}) => ({
  format: 'nutrienttrack-backup', version: BACKUP_VERSION, exportedAt: stamp, entries: [], foods: [], weights: [], settings: [], water: [], measurements: [], ...over,
})
const NUTRIENT_KEYS = ['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol']
const goodIngredient = { name: 'Oats', calories: 300, protein: 10, carbs: 50, fat: 6 }

describe('entries', () => {
  it('accept every optional nutrient as a non-negative number, zero included', () => {
    const all = Object.fromEntries(NUTRIENT_KEYS.map((key, index) => [key, index]))
    expect(validateBackup(backup({ entries: [entry(all)] }))).toBe(true)
  })

  it.each(NUTRIENT_KEYS)('reject a negative %s', (key) => {
    expect(validateBackup(backup({ entries: [entry({ [key]: -1 })] }))).toBe(false)
  })

  it.each(NUTRIENT_KEYS)('reject a string %s', (key) => {
    expect(validateBackup(backup({ entries: [entry({ [key]: '5' })] }))).toBe(false)
  })

  it('reject a NaN or null nutrient', () => {
    expect(validateBackup(backup({ entries: [entry({ fiber: Number.NaN })] }))).toBe(false)
    expect(validateBackup(backup({ entries: [entry({ fiber: null })] }))).toBe(false)
  })

  it('accept a boolean planned flag, true or false', () => {
    expect(validateBackup(backup({ entries: [entry({ planned: true }), entry({ id: 'e2', planned: false })] }))).toBe(true)
  })

  it('reject a string planned flag', () => {
    expect(validateBackup(backup({ entries: [entry({ planned: 'true' })] }))).toBe(false)
  })

  it('still validate with unknown extra fields (invariant 1)', () => {
    expect(validateBackup(backup({ entries: [entry({ fiber: 2, futureField: { a: 1 }, glycemicIndex: 55 })] }))).toBe(true)
  })
})

describe('foods', () => {
  it('accept every optional nutrient as a non-negative number', () => {
    const all = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, 3]))
    expect(validateBackup(backup({ foods: [food(all)] }))).toBe(true)
  })

  it.each(NUTRIENT_KEYS)('reject a negative %s', (key) => {
    expect(validateBackup(backup({ foods: [food({ [key]: -0.5 })] }))).toBe(false)
  })

  it.each(NUTRIENT_KEYS)('reject a string %s', (key) => {
    expect(validateBackup(backup({ foods: [food({ [key]: '5' })] }))).toBe(false)
  })

  it('accept a boolean favorite and reject a non-boolean one', () => {
    expect(validateBackup(backup({ foods: [food({ favorite: true })] }))).toBe(true)
    expect(validateBackup(backup({ foods: [food({ favorite: 'yes' })] }))).toBe(false)
    expect(validateBackup(backup({ foods: [food({ favorite: 1 })] }))).toBe(false)
  })

  it('accept ingredients arrays, empty or populated, with optional quantity and foodId', () => {
    expect(validateBackup(backup({ foods: [food({ ingredients: [] })] }))).toBe(true)
    expect(validateBackup(backup({ foods: [food({ ingredients: [goodIngredient, { ...goodIngredient, quantity: 2, foodId: 'f9' }], recipeServings: 4 })] }))).toBe(true)
  })

  it('reject ingredients that are not an array', () => {
    expect(validateBackup(backup({ foods: [food({ ingredients: 'oats' })] }))).toBe(false)
    expect(validateBackup(backup({ foods: [food({ ingredients: null })] }))).toBe(false)
  })

  it.each([
    ['a missing name', { calories: 1, protein: 1, carbs: 1, fat: 1 }],
    ['a non-string name', { ...goodIngredient, name: 5 }],
    ['a negative calorie value', { ...goodIngredient, calories: -1 }],
    ['a string macro', { ...goodIngredient, protein: '10' }],
    ['a missing macro', { name: 'Oats', calories: 1, protein: 1, carbs: 1 }],
    ['a null line', null],
    ['a string line', 'oats'],
  ])('reject a malformed ingredient: %s', (_name, bad) => {
    expect(validateBackup(backup({ foods: [food({ ingredients: [goodIngredient, bad] })] }))).toBe(false)
  })

  it('still validate with unknown extra fields, including on ingredients (invariant 1)', () => {
    expect(validateBackup(backup({ foods: [food({ fiber: 2, brand: 'Acme', ingredients: [{ ...goodIngredient, note: 'toasted' }] })] }))).toBe(true)
  })
})

describe('weights', () => {
  it('accept no bodyFat and accept the 0 to 100 range', () => {
    expect(validateBackup(backup({ weights: [weight()] }))).toBe(true)
    expect(validateBackup(backup({ weights: [weight({ bodyFat: 0 }), weight({ id: 'w2', bodyFat: 18.5 }), weight({ id: 'w3', bodyFat: 100 })] }))).toBe(true)
  })

  it.each([[101], [-1], ['x'], ['18'], [Number.NaN], [Infinity], [null]])('reject bodyFat %j', (bad) => {
    expect(validateBackup(backup({ weights: [weight({ bodyFat: bad })] }))).toBe(false)
  })

  it('still validate with unknown extra fields', () => {
    expect(validateBackup(backup({ weights: [weight({ bodyFat: 20, muscleMass: 70 })] }))).toBe(true)
  })
})

describe('isValidSyncRecord applies the same rules to cloud records', () => {
  it('accepts an entry with nutrients and unknown fields', () => {
    expect(isValidSyncRecord('entries', entry({ fiber: 3, planned: true, extra: 1 }), 'e1')).toBe(true)
  })

  it('rejects an entry with a negative nutrient or a string planned', () => {
    expect(isValidSyncRecord('entries', entry({ sodium: -5 }), 'e1')).toBe(false)
    expect(isValidSyncRecord('entries', entry({ planned: 'yes' }), 'e1')).toBe(false)
  })

  it('rejects a food with a malformed ingredient and a weight with bodyFat 101', () => {
    expect(isValidSyncRecord('foods', food({ ingredients: [{ name: 'x' }] }), 'f1')).toBe(false)
    expect(isValidSyncRecord('weights', weight({ bodyFat: 101 }), 'w1')).toBe(false)
  })

  it('accepts a recipe food and a weight with bodyFat', () => {
    expect(isValidSyncRecord('foods', food({ favorite: true, ingredients: [goodIngredient] }), 'f1')).toBe(true)
    expect(isValidSyncRecord('weights', weight({ bodyFat: 22 }), 'w1')).toBe(true)
  })
})

describe('readBackup', () => {
  it('refuses a backup whose entry carries a negative nutrient as invalid', () => {
    expect(readBackup(backup({ entries: [entry({ fiber: -1 })] }))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepts a backup carrying the new optional fields', () => {
    const result = readBackup(backup({ entries: [entry({ fiber: 4 })], foods: [food({ favorite: true, ingredients: [goodIngredient], recipeServings: 2 })], weights: [weight({ bodyFat: 19 })] }))
    expect(result.ok).toBe(true)
  })

  it('still restores the frozen v1 fixture, whose entry already carries sodium: 120', () => {
    const result = readBackup(structuredClone(fixtureV1))
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.backup.entries[2] as unknown as Record<string, unknown>).sodium).toBe(120)
  })
})
