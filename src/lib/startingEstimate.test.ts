import { describe, expect, it } from 'vitest'
import { ACTIVITY_LEVELS, estimateMaintenance, type StartingEstimateInput } from './startingEstimate'

const base: StartingEstimateInput = { formula: 'female', age: 35, heightCm: 170, weightKg: 70, activity: 'light' }

describe('estimateMaintenance', () => {
  it('is Mifflin-St Jeor (female) times the activity factor, rounded to the nearest 10', () => {
    const expected = Math.round(((10 * 70 + 6.25 * 170 - 5 * 35 - 161) * 1.375) / 10) * 10
    expect(estimateMaintenance(base)).toBe(expected)
    expect(expected % 10).toBe(0)
  })
  it('uses +5 instead of -161 for the male formula', () => {
    expect(estimateMaintenance({ ...base, formula: 'male' })).toBe(Math.round(((10 * 70 + 6.25 * 170 - 5 * 35 + 5) * 1.375) / 10) * 10)
  })
  it.each(ACTIVITY_LEVELS.map((l) => [l.value, l.factor] as const))('applies the %s factor %s', (activity, factor) => {
    expect(estimateMaintenance({ ...base, activity })).toBe(Math.round(((10 * 70 + 6.25 * 170 - 5 * 35 - 161) * factor) / 10) * 10)
  })
  it('accepts the boundary values and refuses just outside them', () => {
    expect(estimateMaintenance({ ...base, age: 14 })).toBeDefined()
    expect(estimateMaintenance({ ...base, age: 100 })).toBeDefined()
    expect(estimateMaintenance({ ...base, age: 13.9 })).toBeUndefined()
    expect(estimateMaintenance({ ...base, age: 101 })).toBeUndefined()
    expect(estimateMaintenance({ ...base, heightCm: 100 })).toBeDefined()
    expect(estimateMaintenance({ ...base, heightCm: 250 })).toBeDefined()
    expect(estimateMaintenance({ ...base, heightCm: 99 })).toBeUndefined()
    expect(estimateMaintenance({ ...base, heightCm: 251 })).toBeUndefined()
    expect(estimateMaintenance({ ...base, weightKg: 30 })).toBeDefined()
    expect(estimateMaintenance({ ...base, weightKg: 300 })).toBeDefined()
    expect(estimateMaintenance({ ...base, weightKg: 29 })).toBeUndefined()
    expect(estimateMaintenance({ ...base, weightKg: 301 })).toBeUndefined()
  })
  it('refuses zero, negative, NaN and infinite values', () => {
    for (const key of ['age', 'heightCm', 'weightKg'] as const) {
      for (const bad of [0, -5, NaN, Infinity]) expect(estimateMaintenance({ ...base, [key]: bad })).toBeUndefined()
    }
  })
  it('refuses an unknown activity', () => {
    expect(estimateMaintenance({ ...base, activity: 'extreme' as never })).toBeUndefined()
    expect(estimateMaintenance({ ...base, activity: 'toString' as never })).toBeUndefined()
  })
})
