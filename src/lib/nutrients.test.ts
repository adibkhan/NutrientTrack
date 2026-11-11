import { describe, expect, it } from 'vitest'
import type { DiaryEntry } from '../types'
import { BASIC_NUTRIENT_KEYS, emptyNutrientDraft, EXTRA_NUTRIENTS, invalidNutrient, NUTRIENT_GROUPS, NUTRIENT_KEYS, NUTRIENTS, nutrientDraftFrom, nutrientValuesFrom, sumNutrients, type NutrientDraft } from './nutrients'

const stamp = '2026-01-01T00:00:00.000Z'
const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'e1', date: '2026-02-01', meal: 'lunch', name: 'Soup', calories: 100, protein: 5, carbs: 10, fat: 2, createdAt: stamp, updatedAt: stamp, ...over,
})
const draft = (over: Partial<NutrientDraft> = {}): NutrientDraft => ({ ...emptyNutrientDraft(), ...over })

describe('NUTRIENTS', () => {
  it('keeps the five original nutrients first, in their original order and units', () => {
    expect(NUTRIENT_KEYS.slice(0, 5)).toEqual(['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol'])
    expect(NUTRIENTS.slice(0, 5).map((n) => n.unit)).toEqual(['g', 'mg', 'g', 'g', 'mg'])
    expect(BASIC_NUTRIENT_KEYS).toEqual(NUTRIENT_KEYS.slice(0, 5))
  })

  it('tracks 33 nutrients with unique keys, a known unit and decimals', () => {
    expect(NUTRIENTS).toHaveLength(33)
    expect(new Set(NUTRIENT_KEYS).size).toBe(33)
    for (const nutrient of NUTRIENTS) {
      expect(['g', 'mg', 'mcg']).toContain(nutrient.unit)
      expect(NUTRIENT_GROUPS).toContain(nutrient.group)
      expect(Number.isInteger(nutrient.decimals)).toBe(true)
    }
  })

  it('uses the FDA adult Daily Values', () => {
    const dv = Object.fromEntries(NUTRIENTS.flatMap((n) => (n.dv === undefined ? [] : [[n.key, `${n.dv} ${n.unit}`]])))
    expect(dv).toEqual({
      fiber: '28 g', sodium: '2300 mg', satFat: '20 g', cholesterol: '300 mg', potassium: '4700 mg', calcium: '1300 mg', iron: '18 mg', magnesium: '420 mg',
      phosphorus: '1250 mg', zinc: '11 mg', copper: '0.9 mg', manganese: '2.3 mg', selenium: '55 mcg', vitaminA: '900 mcg', vitaminC: '90 mg', vitaminD: '20 mcg',
      vitaminE: '15 mg', vitaminK: '120 mcg', thiamin: '1.2 mg', riboflavin: '1.3 mg', niacin: '16 mg', vitaminB6: '1.7 mg', folate: '400 mcg', vitaminB12: '2.4 mcg', choline: '550 mg',
    })
  })

  it('marks sodium, saturated fat and cholesterol as limits and vitamins and minerals as aim-for', () => {
    expect(NUTRIENTS.filter((n) => n.kind === 'limit' && n.dv !== undefined).map((n) => n.key)).toEqual(['sodium', 'satFat', 'cholesterol'])
    for (const nutrient of NUTRIENTS.filter((n) => n.group === 'Vitamins' || n.group === 'Minerals')) {
      if (nutrient.key !== 'sodium') expect(nutrient.kind).toBe('aim')
    }
  })

  it('offers every nutrient outside the original five in one of the four groups', () => {
    expect(EXTRA_NUTRIENTS).toHaveLength(28)
    expect(NUTRIENT_GROUPS).toEqual(['Fats', 'Minerals', 'Vitamins', 'Other'])
    expect(EXTRA_NUTRIENTS.every((n) => NUTRIENT_GROUPS.includes(n.group))).toBe(true)
  })

  it('gives every key an empty draft box, so a manual entry leaves them all "not recorded"', () => {
    const empty = emptyNutrientDraft()
    expect(Object.keys(empty).sort()).toEqual([...NUTRIENT_KEYS].sort())
    expect(Object.values(empty).every((text) => text === '')).toBe(true)
    expect(nutrientValuesFrom(empty)).toEqual({})
  })

  it('round-trips the newer nutrients through a draft, keeping a recorded zero', () => {
    const values = { potassium: 358, vitaminC: 8.7, vitaminB12: 0, copper: 0.081 }
    expect(nutrientValuesFrom(nutrientDraftFrom(values))).toEqual(values)
  })

  it('flags a bad value in a newer box by its label', () => {
    expect(invalidNutrient(draft({ potassium: '-5' }))?.label).toBe('Potassium')
    expect(invalidNutrient(draft({ vitaminD: 'abc' }))?.key).toBe('vitaminD')
  })
})

describe('nutrientDraftFrom', () => {
  it('gives empty boxes for an undefined record and for a record with nothing recorded', () => {
    expect(nutrientDraftFrom(undefined)).toEqual(emptyNutrientDraft())
    expect(nutrientDraftFrom({})).toEqual(emptyNutrientDraft())
  })

  it('shows a missing value as an empty string, not "0"', () => {
    expect(nutrientDraftFrom({ fiber: 4 }).sodium).toBe('')
  })

  it('shows a recorded zero as "0"', () => {
    expect(nutrientDraftFrom({ fiber: 0 }).fiber).toBe('0')
  })

  it('ignores negative, NaN, infinite and non-number values', () => {
    const junk = { fiber: -1, sodium: Number.NaN, sugar: Infinity, satFat: '5', cholesterol: null } as unknown as Parameters<typeof nutrientDraftFrom>[0]
    expect(nutrientDraftFrom(junk)).toEqual(emptyNutrientDraft())
  })
})

describe('nutrientValuesFrom', () => {
  it('omits empty and whitespace-only boxes, so the keys are absent', () => {
    const values = nutrientValuesFrom(draft({ fiber: '3.5', sodium: '   ' }))
    expect(values).toEqual({ fiber: 3.5 })
    expect(values).not.toHaveProperty('sodium')
    expect(nutrientValuesFrom(emptyNutrientDraft())).toEqual({})
  })

  it('keeps a typed 0 as a recorded zero', () => {
    expect(nutrientValuesFrom(draft({ sugar: '0' }))).toEqual({ sugar: 0 })
  })

  it('ignores junk: negative, text and Infinity', () => {
    expect(nutrientValuesFrom(draft({ fiber: '-2', sodium: 'abc', sugar: 'Infinity', satFat: '2' }))).toEqual({ satFat: 2 })
  })
})

describe('invalidNutrient', () => {
  it('is undefined when every box is empty or a number of zero or more', () => {
    expect(invalidNutrient(emptyNutrientDraft())).toBeUndefined()
    expect(invalidNutrient(draft({ fiber: '0', sodium: '1200.5' }))).toBeUndefined()
  })

  it('names the first negative box', () => {
    expect(invalidNutrient(draft({ sugar: '-0.1' }))?.key).toBe('sugar')
  })

  it('flags text and Infinity', () => {
    expect(invalidNutrient(draft({ sodium: 'abc' }))?.label).toBe('Sodium')
    expect(invalidNutrient(draft({ cholesterol: 'Infinity' }))?.key).toBe('cholesterol')
  })

  it('returns the first of several bad boxes in list order', () => {
    expect(invalidNutrient(draft({ cholesterol: '-1', fiber: '-1' }))?.key).toBe('fiber')
  })
})

describe('sumNutrients', () => {
  it('is empty for no entries', () => {
    expect(sumNutrients([])).toEqual({})
  })

  it('omits nutrients nobody recorded', () => {
    const totals = sumNutrients([entry({ fiber: 3 }), entry({ id: 'e2' })])
    expect(Object.keys(totals)).toEqual(['fiber'])
  })

  it('totals each nutrient and counts only the foods that recorded it', () => {
    const totals = sumNutrients([entry({ fiber: 3, sodium: 100 }), entry({ id: 'e2', fiber: 2 }), entry({ id: 'e3' })])
    expect(totals.fiber).toEqual({ total: 5, foods: 2 })
    expect(totals.sodium).toEqual({ total: 100, foods: 1 })
  })

  it('ignores planned entries', () => {
    const totals = sumNutrients([entry({ fiber: 3 }), entry({ id: 'e2', fiber: 10, planned: true })])
    expect(totals.fiber).toEqual({ total: 3, foods: 1 })
    expect(sumNutrients([entry({ fiber: 10, planned: true })])).toEqual({})
  })

  it('counts a recorded zero as a food that recorded the nutrient', () => {
    expect(sumNutrients([entry({ sugar: 0 })]).sugar).toEqual({ total: 0, foods: 1 })
  })

  it('skips non-finite values', () => {
    expect(sumNutrients([entry({ fiber: Number.NaN })])).toEqual({})
  })
})
