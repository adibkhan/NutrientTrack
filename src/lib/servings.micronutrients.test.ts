import { describe, expect, it } from 'vitest'
import { baseFromRecord, nutrientsPer100g, roundNutrient, scaleBase, scaleNutrientsPer100g } from './servings'

describe('scaling the newer nutrients', () => {
  it('scales per-100 g figures to the grams: 118 g of banana', () => {
    const scaled = scaleNutrientsPer100g({ potassium: 358, vitaminC: 8.7, vitaminK: 0.5 }, 118)
    expect(scaled).toEqual({ potassium: 422.44, vitaminC: 10.27, vitaminK: 0.59 })
  })

  it('keeps three significant figures below 1 for the newer nutrients, so small amounts do not round away', () => {
    expect(scaleNutrientsPer100g({ copper: 0.081, thiamin: 0.031 }, 118)).toEqual({ copper: 0.0956, thiamin: 0.0366 })
  })

  it('still rounds the original five to two decimals', () => {
    expect(scaleNutrientsPer100g({ fiber: 1, sodium: 0.333 }, 33.333)).toEqual({ fiber: 0.33, sodium: 0.11 })
  })

  it('leaves a nutrient that was never recorded absent, and a recorded zero as zero', () => {
    const scaled = scaleNutrientsPer100g({ caffeine: 0 }, 200)
    expect(scaled).toEqual({ caffeine: 0 })
    expect(scaled).not.toHaveProperty('potassium')
  })

  it('round-trips grams to per-100 g and back, for snapshots edited later', () => {
    const per100 = nutrientsPer100g({ potassium: 422.44, calcium: 0 }, 118)
    expect(per100?.potassium).toBeCloseTo(358, 1)
    expect(per100?.calcium).toBe(0)
    expect(scaleNutrientsPer100g(per100 ?? {}, 236).potassium).toBeCloseTo(844.88, 1)
  })

  it('scales servings through the base without inventing missing nutrients', () => {
    const base = baseFromRecord({ calories: 200, protein: 1, carbs: 1, fat: 1, potassium: 400, zinc: 1.5 }, 2)
    expect(base.nutrients).toEqual({ potassium: 200, zinc: 0.75 })
    expect(scaleBase(base, 3).nutrients).toEqual({ potassium: 600, zinc: 2.25 })
  })
})

describe('roundNutrient', () => {
  it('never turns a non-zero amount into a stored zero', () => {
    expect(roundNutrient('thiamin', 0.0037)).toBe(0.0037)
    expect(roundNutrient('vitaminB12', 0.00044)).toBe(0.00044)
    expect(roundNutrient('fiber', 0.004)).toBe(0.004)
    expect(roundNutrient('fiber', 0.333)).toBe(0.33)
    expect(roundNutrient('potassium', 422.436)).toBe(422.44)
    expect(roundNutrient('copper', 0)).toBe(0)
  })
})
