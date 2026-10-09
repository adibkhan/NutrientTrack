import type { DiaryEntry, Goals, MealCategory } from '../types'
import { shiftDate } from './utils'

export const CONTRIBUTOR_METRICS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', digits: 0 },
  { key: 'protein', label: 'Protein', unit: 'g', digits: 0 },
  { key: 'carbs', label: 'Carbs', unit: 'g', digits: 0 },
  { key: 'fat', label: 'Fat', unit: 'g', digits: 0 },
  { key: 'fiber', label: 'Fiber', unit: 'g', digits: 1 },
  { key: 'sugar', label: 'Sugar', unit: 'g', digits: 1 },
  { key: 'satFat', label: 'Saturated fat', unit: 'g', digits: 1 },
  { key: 'sodium', label: 'Sodium', unit: 'mg', digits: 0 },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', digits: 0 },
] as const

export type ContributorMetric = (typeof CONTRIBUTOR_METRICS)[number]['key']
export type ContributorRange = 7 | 30 | 90

export interface Contributor {
  name: string
  total: number
  /** Share of the nutrient total, 0 to 1. */
  share: number
}

export interface MealShare {
  meal: MealCategory
  total: number
  share: number
}

export interface NutrientSummary {
  metric: ContributorMetric
  /** Total over the range from foods that recorded this nutrient. */
  total: number
  /** Days in the range with at least one eaten food. */
  loggedDays: number
  /** Average per logged day; undefined when nothing was logged or nothing recorded this nutrient. */
  average?: number
  /** Eaten foods in the range, and how many of them recorded this nutrient: the average only covers those. */
  foods: number
  recordedFoods: number
  /** The biggest contributing foods, largest first, with everything beyond the limit folded into one "Other" row. */
  top: Contributor[]
  byMeal: MealShare[]
}

const MEAL_ORDER: MealCategory[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']

const valueOf = (entry: DiaryEntry, metric: ContributorMetric): number | undefined => {
  const value = entry[metric]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Where a nutrient came from over the last `days` days ending on `endDate`: its average per logged day, the foods that
 * contributed most, and the split across meals. Planned foods are not eaten and are left out. A nutrient that an entry
 * never recorded counts as unknown, not zero, so the numbers cover only the foods that carry it and the summary says how many.
 */
export const summarizeNutrient = (entries: DiaryEntry[], metric: ContributorMetric, endDate: string, days: ContributorRange, topLimit = 5): NutrientSummary => {
  const startDate = shiftDate(endDate, -(days - 1))
  const inRange = entries.filter((entry) => !entry.planned && entry.date >= startDate && entry.date <= endDate)
  const loggedDays = new Set(inRange.map((entry) => entry.date)).size
  const byName = new Map<string, { name: string; total: number }>()
  const byMeal = new Map<MealCategory, number>()
  let total = 0
  let recordedFoods = 0
  for (const entry of inRange) {
    const value = valueOf(entry, metric)
    if (value === undefined) continue
    recordedFoods += 1
    total += value
    const key = entry.name.trim().toLocaleLowerCase()
    const existing = byName.get(key)
    if (existing) existing.total += value
    else byName.set(key, { name: entry.name.trim(), total: value })
    byMeal.set(entry.meal, (byMeal.get(entry.meal) ?? 0) + value)
  }
  const ranked = [...byName.values()].filter((item) => item.total > 0).sort((a, b) => b.total - a.total)
  const top: Contributor[] = ranked.slice(0, topLimit).map((item) => ({ name: item.name, total: item.total, share: total > 0 ? item.total / total : 0 }))
  const rest = ranked.slice(topLimit).reduce((sum, item) => sum + item.total, 0)
  if (rest > 0) top.push({ name: 'Everything else', total: rest, share: total > 0 ? rest / total : 0 })
  const meals: MealShare[] = MEAL_ORDER.filter((meal) => (byMeal.get(meal) ?? 0) > 0).map((meal) => ({ meal, total: byMeal.get(meal) ?? 0, share: total > 0 ? (byMeal.get(meal) ?? 0) / total : 0 }))
  return {
    metric,
    total,
    loggedDays,
    ...(loggedDays > 0 && recordedFoods > 0 ? { average: total / loggedDays } : {}),
    foods: inRange.length,
    recordedFoods,
    top,
    byMeal: meals,
  }
}

/** The goal for a metric, when the goals carry one. Only calories and the three macros have goals. */
export const goalFor = (goals: Goals | undefined, metric: ContributorMetric): number | undefined => {
  const value = metric === 'calories' || metric === 'protein' || metric === 'carbs' || metric === 'fat' ? goals?.[metric] : undefined
  return typeof value === 'number' && value > 0 ? value : undefined
}
