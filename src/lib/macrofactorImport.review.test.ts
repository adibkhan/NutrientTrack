// Regression tests from the adversarial review of the MacroFactor importer.
// @ts-expect-error The app tsconfig has no Node typings; this file runs in Node.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MACROFACTOR_DAY_TOTAL, parseMacroFactorCsv, parseMacroFactorSheets, timeFromFraction } from './macrofactorImport'
import { readXlsx, XlsxError } from './xlsx'
import { buildXlsx, serialOf, type TestSheet } from './testkit/xlsxBuilder'

const today = '2026-11-10'
const lb = { targetUnit: 'lb', assumedUnit: 'lb', today } as const
const fixture = (name: string) => Uint8Array.from(fs.readFileSync(`src/lib/__macrofactor_review__/${name}`))
const parse = async (sheets: TestSheet[], options: Partial<Parameters<typeof parseMacroFactorSheets>[1]> = {}) => parseMacroFactorSheets((await readXlsx(buildXlsx(sheets))).sheets, { ...lb, ...options })
const FOOD = ['Date', 'Food Name', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)']

describe('hardening', () => {
  it('reads_pathological_unclosed_xml_in_linear_time', async () => {
    for (const name of ['redos-40k.xlsx', 'redos-unclosed-rows.xlsx', 'redos-unclosed-c.xlsx']) {
      const started = performance.now()
      await readXlsx(fixture(name)).catch(() => undefined)
      expect(performance.now() - started).toBeLessThan(500)
    }
  })
  it('refuses_workbooks_that_inflate_past_the_part_and_total_limits', async () => {
    for (const name of ['bomb-140MB-x1.xlsx', 'bomb-140MB-x4.xlsx']) {
      await expect(readXlsx(fixture(name))).rejects.toBeInstanceOf(XlsxError)
      await expect(readXlsx(fixture(name))).rejects.toThrow(/too large/)
    }
  })
})

describe('sheet selection', () => {
  it('keeps_one_day_total_per_date_across_sheets_and_skips_target_goal_program_plan_and_trend_sheets', async () => {
    const daily = (name: string, calories: number): TestSheet => ({ name, rows: [['Date', 'Calories', 'Protein', 'Fat', 'Carbs'], ['2026-10-01', calories, 1, 1, 1]] })
    const parsed = await parse([daily('Calories & Macros', 2000), daily('Quick Export', 2500), daily('Calorie Targets', 1800), daily('Goal', 1), daily('Program', 1), daily('Meal Plan', 1), daily('Recommendations', 1), daily('Expenditure', 1), daily('Weight Trend', 1)])
    expect(parsed.entries.map((entry) => entry.calories)).toEqual([2000])
    expect(parsed.sheets.map((sheet) => sheet.kind)).toEqual(['daily', 'daily', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'trend', 'trend'])
    expect(parsed.sheets[1].skipped).toBe(1)
  })
  it('skips_hidden_sheets_and_reports_them', async () => {
    const parsed = parseMacroFactorSheets([{ name: 'Old', rows: [], hidden: true }, { name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], ['2026-10-01', '80']] }], lb)
    expect(parsed.sheets[0].note).toMatch(/Hidden/)
    expect(parsed.weights).toHaveLength(1)
    const book = await readXlsx(fixture('v11-hidden-dup-daily.xlsx'))
    expect(book.sheets.some((sheet) => sheet.hidden)).toBe(true)
  })
  it('a_scale_weight_sheet_wins_over_a_trend_sheet_for_weigh_ins', async () => {
    const book = await readXlsx(fixture('v12-trend-as-weight.xlsx'))
    const parsed = parseMacroFactorSheets(book.sheets, lb)
    expect(parsed.weights).toHaveLength(1)
    expect(parsed.sheets.find((sheet) => sheet.name === 'Weight Trend')?.kind).toBe('trend')
    // A sheet called Scale Weight is read before a generic "Weight" sheet, so its value wins the day.
    const both = await parse([{ name: 'Weight', rows: [['Date', 'Weight (kg)'], ['2026-10-01', 90]] }, { name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], ['2026-10-01', 80]] }])
    expect(both.weights[0].weight).toBe(176.37)
  })
  it('imports_both_from_a_combined_sheet_but_never_reads_grams_of_food_as_body_weight', async () => {
    const parsed = parseMacroFactorSheets((await readXlsx(fixture('v15-combined.xlsx'))).sheets, lb)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.weights).toHaveLength(1)
    const food = await parse([{ name: 'Food Log', rows: [['Date', 'Food Name', 'Calories', 'Weight (g)'], ['2026-10-01', 'Rice', 200, 150]] }])
    expect(food.weights).toEqual([])
    expect(food.entries).toHaveLength(1)
  })
  it('finds_the_header_row_down_to_row_30', async () => {
    const title = Array.from({ length: 28 }, (_, index) => [`note ${index}`])
    const parsed = await parse([{ name: 'Food Log', rows: [...title, FOOD, ['2026-10-01', 'Rice', 200, 4, 40, 1]] }])
    expect(parsed.entries).toHaveLength(1)
  })
  it('marks_day_totals_with_a_stable_field', async () => {
    const parsed = await parse([{ name: 'Calories & Macros', rows: [['Date', 'Calories', 'Protein', 'Fat', 'Carbs'], ['2026-10-01', 2000, 1, 1, 1]] }])
    expect(parsed.entries[0]).toMatchObject({ importedKind: 'day-total', importedFrom: 'macrofactor', name: MACROFACTOR_DAY_TOTAL })
  })
})

describe('numbers in text cells', () => {
  const food = (calories: string, protein: string): TestSheet => ({ name: 'Food', rows: [FOOD, ['2026-10-01', 'X', calories, protein, '1', '1']] })
  it('reads_decimal_commas_and_never_guesses_ambiguous_or_hex_like_text', async () => {
    const parsed = await parse([{ name: 'Food', rows: [FOOD, ['2026-10-01', 'Comma', '250,5', '10,5', '1', '1'], ['2026-10-01', 'Ambiguous', '2,000', '1', '1', '1'], ['2026-10-01', 'Hex', '0x10', '1', '1', '1'], ['2026-10-01', 'Words', '100', 'abc', '1', '1'], ['2026-10-01', 'Plain', '100', '1.5', '1', '1']] }])
    expect(parsed.entries.map((entry) => [entry.name, entry.calories, entry.protein])).toEqual([['Comma', 250.5, 10.5], ['Plain', 100, 1.5]])
    expect(parsed.sheets[0].skipped).toBe(3)
    expect((await parse([food('1.234', '1')])).entries).toHaveLength(0)
  })
  it('numbers_stored_as_numbers_are_exact_even_when_they_look_like_ambiguous_text', async () => {
    const parsed = await parse([{ name: 'Food', rows: [FOOD, ['2026-10-01', 'Num', 200, 1.234, 3, 4]] }])
    expect(parsed.entries[0].protein).toBe(1.23)
  })
  it('converts_kilojoules_only_when_there_is_no_kcal_column', async () => {
    const kj = await parse([{ name: 'Food', rows: [['Date', 'Food Name', 'Energy (kJ)'], ['2026-10-01', 'Oats', 1255.2]] }])
    expect(kj.entries[0].calories).toBe(300)
    const both = await parse([{ name: 'Food', rows: [['Date', 'Food Name', 'Energy (kJ)', 'Calories (kcal)'], ['2026-10-01', 'Oats', 1255.2, 310]] }])
    expect(both.entries[0].calories).toBe(310)
    const book = await readXlsx(fixture('v13-kj.xlsx'))
    expect(parseMacroFactorSheets(book.sheets, lb).entries[0].calories).toBe(300)
  })
})

describe('text dates', () => {
  const weights = (...dates: string[]): TestSheet => ({ name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], ...dates.map((date) => [date, 80])] })
  const days = (parsed: ReturnType<typeof parseMacroFactorSheets>) => parsed.weights.map((weight) => weight.date)

  it('a_day_over_12_settles_the_whole_column', async () => {
    expect(days(await parse([weights('13/01/2026', '01/02/2026')]))).toEqual(['2026-01-13', '2026-02-01'])
    expect(days(await parse([weights('01/13/2026', '01/02/2026')]))).toEqual(['2026-01-13', '2026-01-02'])
  })
  it('an_undecidable_column_uses_dots_as_day_first_and_asks_with_an_example', async () => {
    const parsed = await parse([weights('01.02.2026')])
    expect(days(parsed)).toEqual(['2026-02-01'])
    expect(parsed.sheets[0].askDateOrder).toEqual({ example: '01.02.2026', used: 'dmy' })
    expect(days(await parse([weights('01/02/2026')], { dateOrder: 'dmy' }))).toEqual(['2026-02-01'])
    expect(days(await parse([weights('01/02/2026')], { dateOrder: 'mdy' }))).toEqual(['2026-01-02'])
  })
  it('does_not_ask_when_both_readings_are_the_same_day', async () => {
    expect((await parse([weights('03/03/2026')])).sheets[0].askDateOrder).toBeUndefined()
  })
  it('accepts_trailing_times_year_first_and_compact_dates', async () => {
    expect(days(await parse([weights('1/15/2026 8:30 AM', '2026/01/16', '20260117', '2026-01-18T07:45:00')]))).toEqual(['2026-01-15', '2026-01-16', '2026-01-17', '2026-01-18'])
    const food = await parse([{ name: 'Food', rows: [FOOD, ['1/15/2026 8:30 PM', 'Dinner', 500, 1, 1, 1]] }])
    expect(food.entries[0]).toMatchObject({ date: '2026-01-15', time: '20:30', meal: 'dinner' })
  })
  it('refuses_dates_before_2000_and_more_than_a_day_ahead', async () => {
    const parsed = await parse([weights('1999-12-31', '2000-01-01', '2026-11-11', '2026-11-12')])
    expect(days(parsed)).toEqual(['2000-01-01', '2026-11-11'])
    expect(parsed.sheets[0].skipped).toBe(2)
    const serial = await parse([{ name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], [serialOf('1999-06-01'), 80], [serialOf('2026-10-01'), 80]] }])
    expect(serial.weights).toHaveLength(1)
  })
})

describe('reader misreads', () => {
  it('converts_stones_and_refuses_stone_plus_pound_pairs', async () => {
    const stones = await parse([{ name: 'Scale Weight', rows: [['Date', 'Weight (st)'], ['2026-10-01', 12.5]] }])
    expect(stones.weights[0].weight).toBe(175)
    const kg = await parse([{ name: 'Scale Weight', rows: [['Date', 'Weight (stone)'], ['2026-10-01', 12.5]] }], { targetUnit: 'kg' })
    expect(kg.weights[0].weight).toBe(79.38)
    const pair = await parse([{ name: 'Scale Weight', rows: [['Date', 'Weight (st)', 'Weight (lb)'], ['2026-10-01', 12, 7]] }])
    expect(pair.weights).toEqual([])
    expect(pair.sheets[0].note).toMatch(/stones and pounds/)
  })
  it('treats_body_fat_as_fractions_only_when_every_value_is', async () => {
    const rows = (...fats: Array<number | string | null>): TestSheet => ({ name: 'Scale Weight', rows: [['Date', 'Weight (kg)', 'Body Fat Percentage'], ...fats.map((fat, index) => [`2026-10-0${index + 1}`, 80, fat])] })
    expect((await parse([rows(0.2, 0.25)])).weights.map((weight) => weight.bodyFat)).toEqual([20, 25])
    expect((await parse([rows(0.8, 18)])).weights.map((weight) => weight.bodyFat)).toEqual([0.8, 18])
    expect((await parse([rows('18.5%', '0.5%')])).weights.map((weight) => weight.bodyFat)).toEqual([18.5, 0.5])
    expect((await parse([{ name: 'Scale Weight', rows: [['Date', 'Weight (kg)', 'Fat Percent'], ['2026-10-01', 80, 21]] }])).weights[0].bodyFat).toBe(21)
  })
  it('keeps_a_time_that_rounds_to_midnight_on_the_same_day', async () => {
    expect(timeFromFraction(0.99995)).toBe('23:59')
    expect(timeFromFraction(0.9999)).toBe('23:59')
    const parsed = await parse([{ name: 'Food', rows: [['Date', 'Time', 'Food Name', 'Calories'], [serialOf('2026-10-01'), 0.99996, 'Late', 100]] }])
    expect(parsed.entries[0]).toMatchObject({ date: '2026-10-01', time: '23:59' })
  })
  it('reads_semicolon_and_tab_separated_csv', () => {
    const semicolon = parseMacroFactorCsv(fs.readFileSync('src/lib/__macrofactor_review__/semicolon.csv', 'utf8'), 'x.csv', lb)
    expect(semicolon.sheets[0].kind).not.toBe('unknown')
    const tab = parseMacroFactorCsv('Date\tFood Name\tCalories\n2026-10-01\tToast\t150\n', 'food.csv', lb)
    expect(tab.entries).toHaveLength(1)
    const european = parseMacroFactorCsv('Date;Food Name;Calories;Protein (g)\n2026-10-01;Toast;150,5;4,5\n', 'food.csv', lb)
    expect(european.entries[0]).toMatchObject({ calories: 150.5, protein: 4.5 })
  })
})
