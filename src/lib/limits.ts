import { NUTRIENTS, type NutrientDraft } from './nutrients'

/** Sane caps for one diary entry, enforced when the form saves. Existing stored data and backups are never checked against them. */
export const LIMITS = { calories: 10000, macro: 1000, grams: 5000, servings: 100, nutrient: 100000, nameLength: 120 } as const

const group = (value: number) => new Intl.NumberFormat('en-US').format(value)

/** Round to one decimal place. */
export const round1 = (value: number): number => Math.round(value * 10) / 10
/** Round to two decimal places (servings). */
export const round2 = (value: number): number => Math.round(value * 100) / 100

export interface LimitProblem { field: string; message: string }

const over = (text: string, max: number): boolean => {
  const parsed = Number(text)
  return text.trim() !== '' && Number.isFinite(parsed) && parsed > max
}

/** The first number in an entry draft that is above its cap, with the id of its field and a plain message; undefined when all are fine. */
export const findLimitProblem = (draft: { calories: string; protein: string; carbs: string; fat: string; grams: string; servings: string; nutrients: NutrientDraft }): LimitProblem | undefined => {
  if (over(draft.calories, LIMITS.calories)) return { field: 'entry-calories', message: `That's more than ${group(LIMITS.calories)} kcal for one entry. Check the number.` }
  for (const key of ['protein', 'carbs', 'fat'] as const) {
    if (over(draft[key], LIMITS.macro)) return { field: `entry-${key}`, message: `That's more than ${group(LIMITS.macro)} g of ${key} for one entry. Check the number.` }
  }
  if (over(draft.grams, LIMITS.grams)) return { field: 'entry-grams', message: `That's more than ${group(LIMITS.grams)} g for one entry. Check the number.` }
  if (over(draft.servings, LIMITS.servings)) return { field: 'entry-servings', message: `That's more than ${group(LIMITS.servings)} servings for one entry. Check the number.` }
  for (const nutrient of NUTRIENTS) {
    if (over(draft.nutrients[nutrient.key], LIMITS.nutrient)) return { field: `entry-${nutrient.key}`, message: `That's more than ${group(LIMITS.nutrient)} ${nutrient.unit} of ${nutrient.label.toLowerCase()} for one entry. Check the number.` }
  }
  return undefined
}
