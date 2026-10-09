import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Goals } from '../types'
import { goalFor, summarizeNutrient } from './contributors'

const stamp = '2026-01-01T00:00:00.000Z'
let n = 0
const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: `e-${++n}`, date: '2026-06-10', meal: 'lunch', name: 'Food', calories: 100, protein: 10, carbs: 10, fat: 1, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry
const END = '2026-06-10'

describe('summarizeNutrient range', () => {
  it('excludes_planned_entries', () => {
    const s = summarizeNutrient([entry({ calories: 100 }), entry({ calories: 900, planned: true })], 'calories', END, 7)
    expect(s.total).toBe(100)
    expect(s.foods).toBe(1)
    expect(s.top.map((t) => t.name)).toEqual(['Food'])
  })

  it.each([7, 30, 90] as const)('includes_the_first_day_and_excludes_the_day_before_for_%s_days', (days) => {
    // The window is `days` calendar days ending on END, start inclusive.
    const start = new Date(2026, 5, 10 - (days - 1))
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const before = new Date(start); before.setDate(before.getDate() - 1)
    const s = summarizeNutrient([entry({ date: iso(start), calories: 10 }), entry({ date: iso(before), calories: 1000 }), entry({ date: END, calories: 5 })], 'calories', END, days)
    expect(s.total).toBe(15)
    expect(s.loggedDays).toBe(2)
  })

  it('excludes_future_days_after_the_end_date', () => {
    const s = summarizeNutrient([entry({ date: '2026-06-11', calories: 500 }), entry({ calories: 5 })], 'calories', END, 7)
    expect(s.total).toBe(5)
  })

  it('counts_the_end_date_itself', () => {
    expect(summarizeNutrient([entry({ calories: 7 })], 'calories', END, 7).total).toBe(7)
  })

  it('crosses_a_month_and_year_boundary', () => {
    const s = summarizeNutrient([entry({ date: '2025-12-27', calories: 3 }), entry({ date: '2025-12-26', calories: 50 }), entry({ date: '2026-01-02', calories: 4 })], 'calories', '2026-01-02', 7)
    expect(s.total).toBe(7)
  })
})

describe('summarizeNutrient empty and unknown values', () => {
  it('returns_no_average_for_an_empty_diary', () => {
    const s = summarizeNutrient([], 'calories', END, 30)
    expect(s).toMatchObject({ total: 0, loggedDays: 0, foods: 0, recordedFoods: 0, top: [], byMeal: [] })
    expect(s.average).toBeUndefined()
    expect('average' in s).toBe(false)
  })

  it('treats_a_missing_nutrient_as_not_recorded_not_zero', () => {
    const s = summarizeNutrient([entry({ fiber: 10 }), entry({ name: 'No fiber info' })], 'fiber', END, 7)
    expect(s.foods).toBe(2)
    expect(s.recordedFoods).toBe(1)
    expect(s.average).toBe(10)
    expect(s.top.map((t) => t.name)).toEqual(['Food'])
  })

  it('has_no_average_when_logged_foods_recorded_none_of_it', () => {
    const s = summarizeNutrient([entry(), entry()], 'fiber', END, 7)
    expect(s.loggedDays).toBe(1)
    expect(s.foods).toBe(2)
    expect(s.recordedFoods).toBe(0)
    expect(s.average).toBeUndefined()
    expect(s.top).toEqual([])
  })

  it('keeps_an_explicit_zero_as_recorded_but_ignores_it_in_rankings', () => {
    const s = summarizeNutrient([entry({ sugar: 0, name: 'Water' }), entry({ sugar: 4 })], 'sugar', END, 7)
    expect(s.recordedFoods).toBe(2)
    expect(s.average).toBe(4)
    expect(s.top.map((t) => t.name)).toEqual(['Food'])
  })

  it('ignores_negative_nan_and_string_values_as_not_recorded', () => {
    const s = summarizeNutrient([entry({ sodium: -5 }), entry({ sodium: NaN }), entry({ sodium: '300' }), entry({ sodium: 20 })], 'sodium', END, 7)
    expect(s.recordedFoods).toBe(1)
    expect(s.total).toBe(20)
  })

  it('averages_per_logged_day_not_per_calendar_day', () => {
    const s = summarizeNutrient([entry({ date: '2026-06-10', calories: 100 }), entry({ date: '2026-06-04', calories: 300 })], 'calories', END, 30)
    expect(s.loggedDays).toBe(2)
    expect(s.average).toBe(200)
  })

  it('counts_a_day_with_only_unrecorded_foods_as_logged', () => {
    const s = summarizeNutrient([entry({ date: '2026-06-10', fiber: 6 }), entry({ date: '2026-06-09' })], 'fiber', END, 7)
    expect(s.loggedDays).toBe(2)
    expect(s.average).toBe(3)
  })
})

describe('summarizeNutrient contributors', () => {
  it('merges_the_same_food_name_case_insensitively_and_trimmed', () => {
    const s = summarizeNutrient([entry({ name: 'Oats', calories: 100 }), entry({ name: ' oats ', calories: 50 }), entry({ name: 'OATS', calories: 25 })], 'calories', END, 7)
    expect(s.top).toHaveLength(1)
    expect(s.top[0]).toMatchObject({ name: 'Oats', total: 175 })
    expect(s.top[0].share).toBeCloseTo(1)
  })

  it('lists_the_top_five_largest_first_then_folds_the_rest_into_Everything_else', () => {
    const items = [100, 90, 80, 70, 60, 50, 40].map((calories, i) => entry({ name: `F${i}`, calories }))
    const s = summarizeNutrient(items, 'calories', END, 7)
    expect(s.top.map((t) => t.name)).toEqual(['F0', 'F1', 'F2', 'F3', 'F4', 'Everything else'])
    expect(s.top[5].total).toBe(90)
    expect(s.top.reduce((sum, t) => sum + t.share, 0)).toBeCloseTo(1)
  })

  it('has_no_Everything_else_row_with_exactly_five_foods', () => {
    const items = [5, 4, 3, 2, 1].map((calories, i) => entry({ name: `F${i}`, calories }))
    const s = summarizeNutrient(items, 'calories', END, 7)
    expect(s.top).toHaveLength(5)
    expect(s.top.some((t) => t.name === 'Everything else')).toBe(false)
  })

  it('has_six_rows_with_six_foods', () => {
    const items = [6, 5, 4, 3, 2, 1].map((calories, i) => entry({ name: `F${i}`, calories }))
    const s = summarizeNutrient(items, 'calories', END, 7)
    expect(s.top.map((t) => t.name)).toEqual(['F0', 'F1', 'F2', 'F3', 'F4', 'Everything else'])
    expect(s.top[5].total).toBe(1)
  })

  it('honours_a_zero_top_limit_by_folding_everything', () => {
    const s = summarizeNutrient([entry({ name: 'A', calories: 1 }), entry({ name: 'B', calories: 3 })], 'calories', END, 7, 0)
    expect(s.top).toEqual([{ name: 'Everything else', total: 4, share: 1 }])
  })

  it('shares_of_meals_sum_to_one_in_meal_order', () => {
    const s = summarizeNutrient([
      entry({ meal: 'dinner', calories: 300 }), entry({ meal: 'breakfast', calories: 100 }), entry({ meal: 'snack', calories: 100 }), entry({ meal: 'lunch', calories: 0 }),
    ], 'calories', END, 7)
    expect(s.byMeal.map((m) => m.meal)).toEqual(['breakfast', 'dinner', 'snack'])
    expect(s.byMeal.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1)
    expect(s.byMeal.find((m) => m.meal === 'dinner')?.share).toBeCloseTo(0.6)
  })

  it('never_produces_NaN_when_every_recorded_value_is_zero', () => {
    const s = summarizeNutrient([entry({ fat: 0 })], 'fat', END, 7)
    expect(s.average).toBe(0)
    expect(s.top).toEqual([])
    expect(s.byMeal).toEqual([])
    expect(JSON.stringify(s)).not.toMatch(/null|NaN/)
  })
})

describe('goalFor', () => {
  const goals: Goals = { calories: 2000, protein: 120, carbs: 200, fat: 60, weightUnit: 'lb' }
  it.each(['calories', 'protein', 'carbs', 'fat'] as const)('returns_the_%s_goal', (metric) => {
    expect(goalFor(goals, metric)).toBe(goals[metric])
  })
  it.each(['fiber', 'sugar', 'satFat', 'sodium', 'cholesterol'] as const)('returns_undefined_for_%s', (metric) => {
    expect(goalFor({ ...goals, fiber: 30 } as never, metric)).toBeUndefined()
  })
  it('returns_undefined_without_goals_or_for_a_zero_or_missing_goal', () => {
    expect(goalFor(undefined, 'calories')).toBeUndefined()
    expect(goalFor({ ...goals, calories: 0 }, 'calories')).toBeUndefined()
    expect(goalFor({ protein: 5 } as never, 'carbs')).toBeUndefined()
  })
})
