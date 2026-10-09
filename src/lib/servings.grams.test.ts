// Grams ride along with servings so a barcode entry's weight scales with the stepper.
import { describe, expect, it } from 'vitest'
import { baseFromRecord, scaleBase } from './servings'

const macros = { calories: 100, protein: 10, carbs: 20, fat: 5 }

describe('baseFromRecord with grams', () => {
  it('keeps grams as the amount for one serving', () => {
    expect(baseFromRecord({ ...macros, grams: 40 }).grams).toBe(40)
  })

  it('divides grams by the servings the record was stored with', () => {
    expect(baseFromRecord({ ...macros, calories: 200, grams: 80 }, 2).grams).toBe(40)
  })

  it('leaves grams absent when the record has none, zero or junk', () => {
    expect('grams' in baseFromRecord(macros)).toBe(false)
    expect('grams' in baseFromRecord({ ...macros, grams: 0 })).toBe(false)
    expect('grams' in baseFromRecord({ ...macros, grams: Number.NaN })).toBe(false)
    expect('grams' in baseFromRecord({ ...macros, grams: -5 })).toBe(false)
  })
})

describe('scaleBase with grams', () => {
  it('scales grams with the servings', () => {
    expect(scaleBase(baseFromRecord({ ...macros, grams: 40 }), 2).grams).toBe(80)
    expect(scaleBase(baseFromRecord({ ...macros, grams: 40 }), 3).grams).toBe(120)
  })

  it('rounds grams to one decimal', () => {
    expect(scaleBase(baseFromRecord({ ...macros, grams: 33 }), 1.33).grams).toBe(43.9)
    expect(scaleBase(baseFromRecord({ ...macros, grams: 40 }), 0.333).grams).toBe(13.3)
  })

  it('never adds a grams key when the base has none', () => {
    expect('grams' in scaleBase(baseFromRecord(macros), 2)).toBe(false)
  })
})
