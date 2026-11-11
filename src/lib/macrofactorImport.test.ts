import { describe, expect, it } from 'vitest'
import { dateFromSerial, dropCoveredDayTotals, MACROFACTOR_DAY_TOTAL, parseMacroFactorCsv, parseMacroFactorSheets, timeFromFraction } from './macrofactorImport'
import { parseImport } from './importers'
import { readXlsx } from './xlsx'
import { buildXlsx, serialOf } from './testkit/xlsxBuilder'

const lb = { targetUnit: 'lb', assumedUnit: 'lb' } as const
const kg = { targetUnit: 'kg', assumedUnit: 'kg' } as const

const FOOD_HEADER = ['Date', 'Time', 'Food Name', 'Serving Size', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Sugars (g)', 'Sodium (mg)', 'Saturated Fat (g)', 'Cholesterol (mg)']
const workbook = async (sheets: Parameters<typeof buildXlsx>[0], options?: Parameters<typeof buildXlsx>[1]) => (await readXlsx(buildXlsx(sheets, options)))

describe('Excel serial dates and times', () => {
  it('converts_the_1900_and_1904_systems_without_depending_on_the_time_zone', () => {
    expect(dateFromSerial(45931)).toBe('2025-10-01')
    expect(dateFromSerial(serialOf('2026-02-28'))).toBe('2026-02-28')
    expect(dateFromSerial(serialOf('2024-02-29'))).toBe('2024-02-29')
    expect(dateFromSerial(45931 - 1462, true)).toBe('2025-10-01')
    expect(dateFromSerial(0)).toBeUndefined()
    expect(timeFromFraction(0.5)).toBe('12:00')
    expect(timeFromFraction(serialOf('2026-01-01', 7, 45) % 1)).toBe('07:45')
  })
})

describe('food log sheet', () => {
  it('reads_shared_strings_serial_dates_and_time_fractions_and_places_meals_by_clock', async () => {
    const book = await workbook([{ name: 'Food Log', rows: [
      FOOD_HEADER,
      [serialOf('2026-10-01'), 7 / 24 + 45 / 1440, 'Greek Yogurt', '1 cup', 145, 24.9, 9, 0.9, 0, 7, 80, 0.2, 5],
      [serialOf('2026-10-01'), '12:30 PM', 'Chicken Breast', '180 g', 297, 55.8, 0, 6.4, null, null, null, null, null],
      ['2026-10-02', null, 'Snack bar', null, 210, 4, 30, 8, null, null, null, null, null],
      ['not a date', null, 'Junk', null, 100, 1, 1, 1, null, null, null, null, null],
      ['2026-10-02', null, 'Huge', null, 99999, 1, 1, 1, null, null, null, null, null],
      ['2026-10-02', null, '', null, 100, 1, 1, 1, null, null, null, null, null],
    ] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.sheets).toMatchObject([{ kind: 'food', imported: 3, skipped: 3 }])
    expect(parsed.skipped).toBe(3)
    expect(parsed.entries.map((entry) => [entry.date, entry.time, entry.meal, entry.name, entry.calories])).toEqual([
      ['2026-10-01', '07:45', 'breakfast', 'Greek Yogurt', 145],
      ['2026-10-01', '12:30', 'lunch', 'Chicken Breast', 297],
      ['2026-10-02', undefined, 'other', 'Snack bar', 210],
    ])
    expect(parsed.entries[0]).toMatchObject({ protein: 24.9, carbs: 9, fat: 0.9, fiber: 0, sugar: 7, sodium: 80, satFat: 0.2, cholesterol: 5, importedFrom: 'macrofactor' })
    // Optional nutrients that are blank stay missing rather than zero.
    expect(parsed.entries[1]).not.toHaveProperty('fiber')
    expect(parsed.entries[2]).not.toHaveProperty('time')
  })

  it('works_with_synonyms_missing_optional_columns_and_a_title_row_above_the_header', async () => {
    const book = await workbook([{ name: 'Quick Export - Food', inline: true, rows: [
      ['MacroFactor export'],
      ['day', 'ENERGY', ' food  ', 'Carbohydrates', 'Protein', 'total fat'],
      ['2026-10-03', 400, 'Rice', 80, 8, 2],
    ] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({ date: '2026-10-03', name: 'Rice', calories: 400, carbs: 80, protein: 8, fat: 2, meal: 'other' })
  })

  it('ids_match_the_csv_importer_so_the_same_food_is_one_food', async () => {
    const csv = 'Date,Time,Food Name,Serving Size,Serving Qty,Serving Weight (g),Calories (kcal),Fat (g),Carbs (g),Protein (g)\n2026-10-01,07:45 AM,Greek Yogurt Nonfat,1 cup,1,245,145,0.9,9.0,24.9\n'
    const old = parseImport(csv)!.entries[0]
    const book = await workbook([{ name: 'Food Log', rows: [['Date', 'Time', 'Food Name', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)'], ['2026-10-01', '7:45 AM', 'Greek Yogurt Nonfat', 145, 0.9, 9, 24.9]] }])
    expect(parseMacroFactorSheets(book.sheets, lb).entries[0].id).toBe(old.id)
  })

  it('keeps_repeated_identical_rows_as_separate_foods_with_distinct_ids', async () => {
    const book = await workbook([{ name: 'Food Log', rows: [FOOD_HEADER, ['2026-10-01', null, 'Egg', null, 70, 6, 0, 5], ['2026-10-01', null, 'Egg', null, 70, 6, 0, 5]] }])
    const ids = parseMacroFactorSheets(book.sheets, lb).entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('scale weight sheet', () => {
  it('reads_kg_from_the_header_and_converts_to_the_users_unit', async () => {
    const book = await workbook([{ name: 'Scale Weight', rows: [['Date', 'Weight (kg)', 'Body Fat %'], [serialOf('2026-10-01'), 80, 18.5], ['2026-10-02', 79.5, null], ['2026-10-03', 'abc', null], ['2026-10-04', -3, null]] }])
    const asLb = parseMacroFactorSheets(book.sheets, lb)
    expect(asLb.weights.map((weight) => [weight.date, weight.weight, weight.unit, weight.bodyFat])).toEqual([['2026-10-01', 176.37, 'lb', 18.5], ['2026-10-02', 175.27, 'lb', undefined]])
    expect(asLb.sheets[0]).toMatchObject({ kind: 'weight', imported: 2, skipped: 2 })
    expect(asLb.sheets[0].assumedUnit).toBeUndefined()
    expect(parseMacroFactorSheets(book.sheets, kg).weights[0]).toMatchObject({ weight: 80, unit: 'kg' })
  })

  it('reads_lbs_from_the_header_or_a_unit_column_and_flags_a_unit_it_had_to_assume', async () => {
    const header = parseMacroFactorSheets((await workbook([{ name: 'Weight', rows: [['Date', 'Weight (lbs)'], ['2026-10-01', 176.4]] }])).sheets, kg)
    expect(header.weights[0]).toMatchObject({ weight: 80.01, unit: 'kg' })
    const column = parseMacroFactorSheets((await workbook([{ name: 'Weight', rows: [['Date', 'Weight', 'Unit'], ['2026-10-01', 80, 'kg'], ['2026-10-02', 176, 'lbs']] }])).sheets, lb)
    expect(column.weights.map((weight) => weight.weight)).toEqual([176.37, 176])
    const assumed = parseMacroFactorSheets((await workbook([{ name: 'Weight', rows: [['Date', 'Weight'], ['2026-10-01', 80]] }])).sheets, { targetUnit: 'lb', assumedUnit: 'kg' })
    expect(assumed.sheets[0].assumedUnit).toBe(true)
    expect(assumed.weights[0].weight).toBe(176.37)
  })

  it('reads_body_fat_stored_as_a_fraction', async () => {
    const parsed = parseMacroFactorSheets((await workbook([{ name: 'Scale Weight', rows: [['Date', 'Weight (kg)', 'Body Fat'], ['2026-10-01', 80, 0.215]] }])).sheets, kg)
    expect(parsed.weights[0].bodyFat).toBe(21.5)
  })
})

describe('daily summary and other sheets', () => {
  const daily = { name: 'Calories & Macros', rows: [['Date', 'Calories', 'Protein', 'Fat', 'Carbs'], ['2026-10-01', 2100, 150, 70, 220], ['2026-10-02', 0, 0, 0, 0], ['2026-10-03', 1900, 140, 60, 200]] }

  it('imports_one_named_total_per_day_and_skips_empty_days', async () => {
    const parsed = parseMacroFactorSheets((await workbook([daily])).sheets, lb)
    expect(parsed.sheets[0]).toMatchObject({ kind: 'daily', imported: 2, skipped: 1 })
    expect(parsed.entries.map((entry) => [entry.date, entry.name, entry.meal, entry.calories, entry.protein, entry.carbs, entry.fat])).toEqual([
      ['2026-10-01', MACROFACTOR_DAY_TOTAL, 'other', 2100, 150, 220, 70],
      ['2026-10-03', MACROFACTOR_DAY_TOTAL, 'other', 1900, 140, 200, 60],
    ])
  })

  it('never_keeps_a_day_total_for_a_day_that_has_foods_or_is_already_logged', async () => {
    const book = await workbook([daily, { name: 'Food Log', rows: [FOOD_HEADER, ['2026-10-01', '8:00 AM', 'Oats', null, 300, 10, 50, 5]] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    const { kept, dropped } = dropCoveredDayTotals(parsed.entries)
    expect(dropped).toBe(1)
    expect(kept.map((entry) => [entry.date, entry.name])).toEqual([['2026-10-03', MACROFACTOR_DAY_TOTAL], ['2026-10-01', 'Oats']])
    expect(dropCoveredDayTotals(parsed.entries, new Set(['2026-10-03'])).dropped).toBe(2)
  })

  it('reports_expenditure_and_trend_sheets_without_storing_them_and_flags_unknown_sheets', async () => {
    const book = await workbook([
      { name: 'Expenditure', rows: [['Date', 'Expenditure'], ['2026-10-01', 2500]] },
      { name: 'Trend Weight', rows: [['Date', 'Trend Weight (kg)'], ['2026-10-01', 80]] },
      { name: 'Notes', rows: [['Hello'], ['world']] },
    ])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.entries).toEqual([])
    expect(parsed.weights).toEqual([])
    expect(parsed.sheets.map((sheet) => sheet.kind)).toEqual(['trend', 'trend', 'unknown'])
    expect(parsed.sheets[0].note).toBe("Expenditure history isn't imported; NutrientTrack recalculates it from your weights and food.")
    expect(parsed.sheets[2].note).toContain("Tell us if a sheet didn't import")
  })

  it('imports_every_recognised_sheet_of_one_workbook_next_to_unknown_ones', async () => {
    const book = await workbook([{ name: 'Notes', rows: [['x']] }, daily, { name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], ['2026-10-01', 80]] }])
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.weights).toHaveLength(1)
  })
})

describe('csv export of a sheet', () => {
  it('reads_a_csv_of_the_same_sheets_named_after_the_file', () => {
    const food = parseMacroFactorCsv('Date,Food Name,Calories,Protein (g),Carbs (g),Fat (g)\n2026-10-01,Toast,150,5,25,3\n', 'Quick Export - Food.csv', lb)
    expect(food.sheets[0]).toMatchObject({ name: 'Quick Export - Food', kind: 'food', imported: 1 })
    const weights = parseMacroFactorCsv('Date,Scale Weight (kg),Body Fat\n10/01/2026,80,\n', 'weight.csv', lb)
    expect(weights.weights[0]).toMatchObject({ date: '2026-10-01', unit: 'lb' })
    expect(parseMacroFactorCsv('a,b\n1,2\n', 'x.csv', lb).sheets[0].kind).toBe('unknown')
  })
})
