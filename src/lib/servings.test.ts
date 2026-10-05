import { describe, expect, it } from 'vitest'
import { baseFromRecord, nutrientsPer100g, scaleBase, scaleNutrientsPer100g } from './servings'

const record = { calories: 400, protein: 20, carbs: 40, fat: 10 }

describe('baseFromRecord', () => {
  it('divides macros and recorded nutrients by the servings', () => {
    const base = baseFromRecord({ ...record, fiber: 8, sodium: 200 }, 2)
    expect(base).toEqual({ calories: 200, protein: 10, carbs: 20, fat: 5, nutrients: { fiber: 4, sodium: 100 } })
  })

  it('defaults to one serving', () => {
    expect(baseFromRecord(record).calories).toBe(400)
  })

  it.each([0, -2, NaN, Infinity])('counts %s servings as one', (servings) => {
    expect(baseFromRecord(record, servings).calories).toBe(400)
  })

  it('turns negative and NaN macros into zero', () => {
    const base = baseFromRecord({ calories: -5, protein: NaN, carbs: 40, fat: Infinity }, 1)
    expect(base).toMatchObject({ calories: 0, protein: 0, carbs: 40, fat: 0 })
  })

  it('keeps an absent nutrient absent rather than zero', () => {
    const base = baseFromRecord({ ...record, fiber: 6 }, 3)
    expect(base.nutrients).toEqual({ fiber: 2 })
    expect('sodium' in base.nutrients).toBe(false)
  })

  it('keeps a recorded zero nutrient as zero', () => {
    expect(baseFromRecord({ ...record, fiber: 0 }).nutrients).toEqual({ fiber: 0 })
  })

  it('drops invalid nutrient values', () => {
    const base = baseFromRecord({ ...record, fiber: -1, sugar: NaN, sodium: '5' as unknown as number }, 1)
    expect(base.nutrients).toEqual({})
  })
})

describe('scaleBase', () => {
  const base = baseFromRecord({ ...record, fiber: 3 }, 1)

  it('scales every figure by the factor', () => {
    expect(scaleBase(base, 2)).toEqual({ calories: 800, protein: 40, carbs: 80, fat: 20, nutrients: { fiber: 6 } })
  })

  it('rounds to two decimals', () => {
    const third = baseFromRecord({ calories: 100, protein: 1, carbs: 1, fat: 1, fiber: 1 }, 3)
    const scaled = scaleBase(third, 1)
    expect(scaled.calories).toBe(33.33)
    expect(scaled.nutrients.fiber).toBe(0.33)
  })

  it('handles half servings', () => {
    expect(scaleBase(base, 0.5).calories).toBe(200)
  })

  it.each([0, -1, NaN])('gives zeros for a factor of %s', (factor) => {
    expect(scaleBase(base, factor)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, nutrients: { fiber: 0 } })
  })

  it('keeps absent nutrients absent', () => {
    const scaled = scaleBase(baseFromRecord(record), 3)
    expect(scaled.nutrients).toEqual({})
  })
})

describe('nutrientsPer100g', () => {
  it('converts an amount to per 100 g', () => {
    expect(nutrientsPer100g({ fiber: 10 }, 200)).toEqual({ fiber: 5 })
  })

  it.each([0, -50, NaN, Infinity])('is undefined for %s grams', (grams) => {
    expect(nutrientsPer100g({ fiber: 10 }, grams)).toBeUndefined()
  })

  it('is undefined when no nutrient is recorded', () => {
    expect(nutrientsPer100g({}, 100)).toBeUndefined()
  })

  it('skips invalid values but keeps valid ones', () => {
    expect(nutrientsPer100g({ fiber: 10, sugar: -1 }, 100)).toEqual({ fiber: 10 })
  })
})

describe('scaleNutrientsPer100g', () => {
  it('scales per 100 g figures to the amount', () => {
    expect(scaleNutrientsPer100g({ fiber: 10, sodium: 4 }, 250)).toEqual({ fiber: 25, sodium: 10 })
  })

  it('rounds to two decimals', () => {
    expect(scaleNutrientsPer100g({ fiber: 1 }, 33.333)).toEqual({ fiber: 0.33 })
  })

  it.each([0, -10, NaN])('gives zeros for %s grams', (grams) => {
    expect(scaleNutrientsPer100g({ fiber: 10 }, grams)).toEqual({ fiber: 0 })
  })

  it('keeps absent nutrients absent', () => {
    expect(scaleNutrientsPer100g({ fiber: 10 }, 100)).not.toHaveProperty('sodium')
  })
})
