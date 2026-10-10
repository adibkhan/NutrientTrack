import { describe, expect, it } from 'vitest'
import { dateFrom, detectFormat, mealFrom, parseCsv, parseImport, timeFrom } from './importers'

// Header rows as published by each app (or by parsers built against real exports); rows are illustrative.
const MFP_NUTRITION = `Date,Meal,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note
2026-09-28,Breakfast,550.0,15.0,4,1,2,0,30,400,300,60.0,8,10,45.0,0,0,0,0,
2026-09-28,Dinner,"1,000.0",30.0,8,2,3,0,90,900,800,90.0,10,8,90.0,0,0,0,0,late meal
2026-09-29,Snacks,,1,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,
`
const MFP_MEASUREMENTS = `Date,Weight,Body Fat %
2026-09-28,205.3,31.3
2026-09-29,207.6,
`
const CRONOMETER_SERVINGS = `﻿Day,Time,Group,Food Name,Amount,Energy (kcal),Caffeine (mg),Carbs (g),Fiber (g),Sugars (g),Fat (g),Cholesterol (mg),Saturated (g),Trans-Fats (g),Protein (g),Sodium (mg),Category
2026-08-16,8:30 AM,Breakfast,"Oats, Rolled, Dry",0.50 cup - 40g,152.00,0.00,27.00,4.00,0.40,2.70,0.00,0.50,0.00,5.30,2.00,Breakfast Cereals
2026-08-16,7:05 PM,Uncategorized,Chicken Breast,150.00 g,248.00,0.00,0.00,,,5.40,128.00,1.50,0.00,46.50,111.00,Poultry
`
const CRONOMETER_BIOMETRICS = `Day,Time,Group,Metric,Unit,Amount
2026-08-16,7:05 AM,Unspecified,Weight,lbs,182.4
2026-08-16,7:06 AM,Unspecified,Blood Pressure,mmHg,120/80
2026-08-17,7:05 AM,Unspecified,Weight,kg,82.5
`
const LOSEIT_FOOD = `Date,Name,Icon,Type,Quantity,Units,Calories,Deleted,Fat (g),Protein (g),Carbohydrates (g),Saturated Fat (g),Sugars (g),Fiber (g),Cholesterol (mg),Sodium (mg)
01/05/2026,Oatmeal,Oatmeal,Breakfast,1,Cup,166,false,3.6,5.9,28,0.6,0.6,4,0,9
01/05/2026,Cookie,Cookie,Snacks,2,Each,160,true,8,2,20,4,12,1,10,110
`
const LOSEIT_WEIGHTS = `Date,Weight,Deleted
01/05/2026,182.4,false
01/06/2026,181.9,true
`
const MACROFACTOR_FOOD = `Date,Time,Food Name,Serving Size,Serving Qty,Serving Weight (g),Calories (kcal),Fat (g),Carbs (g),Protein (g)
2026-10-01,07:45 AM,Greek Yogurt Nonfat,1 cup,1,245,145,0.9,9.0,24.9
2026-10-01,12:30 PM,Chicken Breast Cooked,g,180,180,297,6.4,0,55.8
`

describe('parseCsv', () => {
  it('handles_quotes_doubled_quotes_crlf_and_a_byte_order_mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
  })
})

describe('detectFormat', () => {
  it.each([
    [MFP_NUTRITION, 'mfp-nutrition'], [MFP_MEASUREMENTS, 'mfp-measurements'], [CRONOMETER_SERVINGS, 'cronometer-servings'], [CRONOMETER_BIOMETRICS, 'cronometer-biometrics'],
    [LOSEIT_FOOD, 'loseit-food'], [LOSEIT_WEIGHTS, 'loseit-weights'], [MACROFACTOR_FOOD, 'macrofactor-food'],
  ])('recognizes_each_export_by_its_headers', (text, format) => {
    expect(detectFormat(parseCsv(text)[0])).toBe(format)
  })

  it('rejects_an_unrelated_csv', () => {
    expect(parseImport('name,price\nbook,10\n')).toBeUndefined()
  })
})

describe('field readers', () => {
  it('reads_iso_and_us_dates_and_swaps_an_unmistakable_day_first_date', () => {
    expect(dateFrom('2026-09-28')).toBe('2026-09-28')
    expect(dateFrom('01/05/2026')).toBe('2026-01-05')
    expect(dateFrom('28/09/2026')).toBe('2026-09-28')
    expect(dateFrom('02/30/2026')).toBeUndefined()
    expect(dateFrom('')).toBeUndefined()
  })

  it('reads_12_and_24_hour_times', () => {
    expect(timeFrom('8:30 AM')).toBe('08:30')
    expect(timeFrom('12:05 AM')).toBe('00:05')
    expect(timeFrom('7:05 PM')).toBe('19:05')
    expect(timeFrom('13:45')).toBe('13:45')
    expect(timeFrom('')).toBeUndefined()
  })

  it('maps_meal_names_and_falls_back_to_the_clock', () => {
    expect(mealFrom('Snacks')).toBe('snack')
    expect(mealFrom('Uncategorized')).toBe('other')
    expect(mealFrom('', '07:45')).toBe('breakfast')
  })
})

describe('parseImport', () => {
  it('turns_myfitnesspal_meal_totals_into_one_entry_per_meal', () => {
    const result = parseImport(MFP_NUTRITION)!
    expect(result.entries).toHaveLength(2)
    expect(result.skipped).toBe(1)
    expect(result.entries[1]).toMatchObject({ date: '2026-09-28', meal: 'dinner', name: 'MyFitnessPal dinner', calories: 1000, protein: 90, carbs: 90, fat: 30, fiber: 10, sugar: 8, sodium: 900, satFat: 8, cholesterol: 90, importedFrom: 'myfitnesspal' })
  })

  it('reads_myfitnesspal_weights_in_the_chosen_unit_with_body_fat_when_present', () => {
    const result = parseImport(MFP_MEASUREMENTS, 'kg')!
    expect(result.weights.map((weight) => [weight.date, weight.weight, weight.unit, weight.bodyFat])).toEqual([['2026-09-28', 205.3, 'kg', 31.3], ['2026-09-29', 207.6, 'kg', undefined]])
  })

  it('reads_cronometer_foods_with_times_and_leaves_blank_nutrients_unrecorded', () => {
    const [oats, chicken] = parseImport(CRONOMETER_SERVINGS)!.entries
    expect(oats).toMatchObject({ name: 'Oats, Rolled, Dry', meal: 'breakfast', time: '08:30', calories: 152, carbs: 27, fiber: 4, sugar: 0.4, satFat: 0.5 })
    expect(chicken).toMatchObject({ meal: 'other', time: '19:05', protein: 46.5, sodium: 111 })
    expect('fiber' in chicken).toBe(false)
    expect('sugar' in chicken).toBe(false)
  })

  it('takes_only_weight_rows_from_cronometer_biometrics_in_their_own_unit', () => {
    const result = parseImport(CRONOMETER_BIOMETRICS)!
    expect(result.weights.map((weight) => [weight.weight, weight.unit])).toEqual([[182.4, 'lb'], [82.5, 'kg']])
  })

  it('skips_rows_deleted_in_lose_it', () => {
    const food = parseImport(LOSEIT_FOOD)!
    expect(food.entries.map((entry) => entry.name)).toEqual(['Oatmeal'])
    expect(food.skipped).toBe(1)
    expect(food.entries[0]).toMatchObject({ date: '2026-01-05', meal: 'breakfast', calories: 166 })
    expect(parseImport(LOSEIT_WEIGHTS, 'lb')!.weights).toHaveLength(1)
  })

  it('places_macrofactor_foods_into_meals_by_time', () => {
    const entries = parseImport(MACROFACTOR_FOOD)!.entries
    expect(entries.map((entry) => [entry.meal, entry.time, entry.calories, entry.protein])).toEqual([['breakfast', '07:45', 145, 24.9], ['lunch', '12:30', 297, 55.8]])
  })

  it('gives_the_same_ids_to_the_same_rows_so_a_second_import_adds_nothing', () => {
    const first = parseImport(CRONOMETER_SERVINGS)!.entries.map((entry) => entry.id)
    const second = parseImport(CRONOMETER_SERVINGS)!.entries.map((entry) => entry.id)
    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
    const doubled = parseImport(CRONOMETER_SERVINGS + CRONOMETER_SERVINGS.split('\n').slice(1).join('\n'))!.entries.map((entry) => entry.id)
    expect(new Set(doubled).size).toBe(4)
  })
})
