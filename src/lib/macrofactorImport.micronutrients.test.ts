import { describe, expect, it } from 'vitest'
import { parseMacroFactorSheets } from './macrofactorImport'
import { readXlsx } from './xlsx'
import { buildXlsx } from './testkit/xlsxBuilder'

const lb = { targetUnit: 'lb', assumedUnit: 'lb' } as const
const workbook = async (sheets: Parameters<typeof buildXlsx>[0]) => readXlsx(buildXlsx(sheets))
const BASE = ['Date', 'Food Name', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)']

describe('MacroFactor food log micronutrient columns', () => {
  it('maps every header that names a stored nutrient and converts units', async () => {
    const book = await workbook([{ name: 'Food Log', rows: [
      [...BASE, 'Fiber (g)', 'Sugars (g)', 'Sodium (mg)', 'Saturated Fat (g)', 'Trans Fat (g)', 'Cholesterol (mg)', 'Potassium (mg)', 'Calcium (g)', 'Iron (mg)', 'Magnesium (mg)', 'Zinc (mg)', 'Vitamin C (mg)', 'Vitamin D (IU)', 'Vitamin B12 (mcg)', 'Folate (mcg)', 'Vitamin K (mg)'],
      ['2026-10-01', 'Salmon', 300, 30, 0, 18, 0, 0, 80, 4.5, 0.002, 55, 800, 0.9, 0, 30, 0.5, 0.5, 600, 4.8, 20, 0.12],
    ] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({ sodium: 80, satFat: 4.5, potassium: 800, calcium: 900, iron: 0, magnesium: 30, zinc: 0.5, vitaminC: 0.5, vitaminD: 15, vitaminB12: 4.8, folate: 20, vitaminK: 120, fiber: 0, transFat: 0.002, cholesterol: 55 })
      })

  it('never turns a real small value into a stored zero and keeps blank cells absent', async () => {
    const book = await workbook([{ name: 'Food Log', rows: [
      [...BASE, 'Selenium (mcg)', 'Copper (mg)', 'Iron (mg)'],
      ['2026-10-01', 'Tea', 2, 0, 0.4, 0, 0.0004, null, 0.00012],
    ] }])
    const [entry] = parseMacroFactorSheets(book.sheets, lb).entries
    expect(entry.selenium).toBeGreaterThan(0)
    expect(entry.iron).toBeGreaterThan(0)
    expect('copper' in entry).toBe(false)
  })

  it('skips vitamin A unless it is mcg, leaves IU columns out and says so', async () => {
    const book = await workbook([{ name: 'Food Log', rows: [
      [...BASE, 'Vitamin A (IU)', 'Vitamin E (IU)', 'Vitamin D (mcg)'],
      ['2026-10-01', 'Carrot', 40, 1, 9, 0, 5000, 3, 1],
      ['2026-10-02', 'Egg', 70, 6, 0.4, 5, 100, 1, 1.1],
    ] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.entries[0].vitaminA).toBeUndefined()
    expect(parsed.entries[0].vitaminE).toBeUndefined()
    expect(parsed.entries[0].vitaminD).toBe(1)
    expect(parsed.sheets[0].note).toContain('vitamin a (iu)')
    const mcg = parseMacroFactorSheets((await workbook([{ name: 'Food Log', rows: [[...BASE, 'Vitamin A (mcg RAE)'], ['2026-10-01', 'Carrot', 40, 1, 9, 0, 835]] }])).sheets, lb)
    expect(mcg.entries[0].vitaminA).toBe(835)
  })

  it('applies the same caps: an absurd amount makes the row unreadable', async () => {
    const book = await workbook([{ name: 'Food Log', rows: [
      [...BASE, 'Potassium (mg)'],
      ['2026-10-01', 'Pill', 10, 0, 0, 0, 5_000_000],
      ['2026-10-01', 'Banana', 105, 1, 27, 0, 422],
    ] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.entries.map((entry) => entry.name)).toEqual(['Banana'])
    expect(parsed.sheets[0].skipped).toBe(1)
  })

  it('reports a separate Micronutrients daily sheet as not imported', async () => {
    const book = await workbook([
      { name: 'Calories & Macros', rows: [['Date', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'], ['2026-10-01', 2000, 150, 200, 60]] },
      { name: 'Micronutrients', rows: [['Date', 'Potassium (mg)', 'Calcium (mg)'], ['2026-10-01', 3000, 900]] },
    ])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.sheets.map((sheet) => sheet.kind)).toEqual(['daily', 'skipped'])
    expect(parsed.sheets[1].note).toContain('Micronutrients')
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].potassium).toBeUndefined()
  })
})
