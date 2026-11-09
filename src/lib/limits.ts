import { ambiguityMessage, parseDecimal } from './decimal'
import { NUTRIENTS, type NutrientDraft } from './nutrients'

/** Sane caps for one diary entry, enforced when the form saves. Existing stored data and backups are never checked against them. */
export const LIMITS = { calories: 10000, macro: 1000, grams: 5000, servings: 100, nutrient: 100000, nameLength: 120 } as const

/** Round to one decimal place. */
export const round1 = (value: number): number => Math.round(value * 10) / 10
/** Round to two decimal places (servings). */
export const round2 = (value: number): number => Math.round(value * 100) / 100

export interface LimitProblem { field: string; message: string }

const over = (text: string, max: number): boolean => {
  const parsed = parseDecimal(text)
  return text.trim() !== '' && Number.isFinite(parsed) && parsed > max
}

/** The first number in an entry draft that is above its cap, with the id of its field and a plain message; undefined when all are fine. */
export const findLimitProblem = (draft: { calories: string; protein: string; carbs: string; fat: string; grams: string; servings: string; nutrients: NutrientDraft }): LimitProblem | undefined => {
  if (over(draft.calories, LIMITS.calories)) return { field: 'entry-calories', message: `That's more than ${LIMITS.calories} kcal for one entry. Check the number.` }
  for (const key of ['protein', 'carbs', 'fat'] as const) {
    if (over(draft[key], LIMITS.macro)) return { field: `entry-${key}`, message: `That's more than ${LIMITS.macro} g of ${key} for one entry. Check the number.` }
  }
  if (over(draft.grams, LIMITS.grams)) return { field: 'entry-grams', message: `That's more than ${LIMITS.grams} g for one entry. Check the number.` }
  if (over(draft.servings, LIMITS.servings)) return { field: 'entry-servings', message: `That's more than ${LIMITS.servings} servings for one entry. Check the number.` }
  for (const nutrient of NUTRIENTS) {
    if (over(draft.nutrients[nutrient.key], LIMITS.nutrient)) return { field: `entry-${nutrient.key}`, message: `That's more than ${LIMITS.nutrient} ${nutrient.unit} of ${nutrient.label.toLowerCase()} for one entry. Check the number.` }
  }
  return undefined
}

/** The first typed number that could be read two ways ("2,000"), with the id of its field and the message; undefined when none is. */
export const findAmbiguousProblem = (draft: { calories: string; protein: string; carbs: string; fat: string; grams: string; servings: string; nutrients: NutrientDraft }, options: { servings: boolean }): LimitProblem | undefined => {
  const fields: Array<[string, string]> = [['entry-calories', draft.calories], ['entry-protein', draft.protein], ['entry-carbs', draft.carbs], ['entry-fat', draft.fat], ['entry-grams', draft.grams]]
  if (options.servings) fields.push(['entry-servings', draft.servings])
  for (const nutrient of NUTRIENTS) fields.push([`entry-${nutrient.key}`, draft.nutrients[nutrient.key]])
  for (const [field, text] of fields) {
    const message = ambiguityMessage(text)
    if (message) return { field, message }
  }
  return undefined
}
