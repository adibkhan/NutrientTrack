import type { DiaryEntry } from '../types'
import { inputText, parseDecimal } from './decimal'

export type NutrientUnit = 'g' | 'mg' | 'mcg'
export type NutrientGroup = 'Fats' | 'Minerals' | 'Vitamins' | 'Other'
/** "limit" nutrients are best kept at or under their daily value; "aim" nutrients are best met. */
export type NutrientKind = 'limit' | 'aim'

interface NutrientDef {
  key: string
  label: string
  unit: NutrientUnit
  /** Decimals when shown. */
  decimals: number
  group: NutrientGroup
  kind: NutrientKind
  /** FDA Daily Value for adults (2016 label rules) in `unit`, where one exists. */
  dv?: number
}

/**
 * Extra nutrients a food or entry can carry. Each is optional: missing means "not recorded", never zero.
 * The first five are the original fields and keep their order; the rest were added with micronutrient tracking.
 * Key names are also the header of public/data/usda-nutrients-v1.json.
 */
const DEFS = [
  { key: 'fiber', label: 'Fiber', unit: 'g', decimals: 1, group: 'Other', kind: 'aim', dv: 28 },
  { key: 'sodium', label: 'Sodium', unit: 'mg', decimals: 0, group: 'Minerals', kind: 'limit', dv: 2300 },
  { key: 'sugar', label: 'Sugar', unit: 'g', decimals: 1, group: 'Other', kind: 'limit' },
  { key: 'satFat', label: 'Saturated fat', unit: 'g', decimals: 1, group: 'Fats', kind: 'limit', dv: 20 },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', decimals: 0, group: 'Fats', kind: 'limit', dv: 300 },
  { key: 'monoFat', label: 'Monounsaturated fat', unit: 'g', decimals: 1, group: 'Fats', kind: 'aim' },
  { key: 'polyFat', label: 'Polyunsaturated fat', unit: 'g', decimals: 1, group: 'Fats', kind: 'aim' },
  { key: 'transFat', label: 'Trans fat', unit: 'g', decimals: 1, group: 'Fats', kind: 'limit' },
  { key: 'omega3', label: 'Omega-3', unit: 'g', decimals: 2, group: 'Fats', kind: 'aim' },
  { key: 'potassium', label: 'Potassium', unit: 'mg', decimals: 0, group: 'Minerals', kind: 'aim', dv: 4700 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', decimals: 0, group: 'Minerals', kind: 'aim', dv: 1300 },
  { key: 'iron', label: 'Iron', unit: 'mg', decimals: 1, group: 'Minerals', kind: 'aim', dv: 18 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', decimals: 0, group: 'Minerals', kind: 'aim', dv: 420 },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg', decimals: 0, group: 'Minerals', kind: 'aim', dv: 1250 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', decimals: 1, group: 'Minerals', kind: 'aim', dv: 11 },
  { key: 'copper', label: 'Copper', unit: 'mg', decimals: 2, group: 'Minerals', kind: 'aim', dv: 0.9 },
  { key: 'manganese', label: 'Manganese', unit: 'mg', decimals: 2, group: 'Minerals', kind: 'aim', dv: 2.3 },
  { key: 'selenium', label: 'Selenium', unit: 'mcg', decimals: 1, group: 'Minerals', kind: 'aim', dv: 55 },
  { key: 'vitaminA', label: 'Vitamin A', unit: 'mcg', decimals: 0, group: 'Vitamins', kind: 'aim', dv: 900 },
  { key: 'vitaminC', label: 'Vitamin C', unit: 'mg', decimals: 1, group: 'Vitamins', kind: 'aim', dv: 90 },
  { key: 'vitaminD', label: 'Vitamin D', unit: 'mcg', decimals: 1, group: 'Vitamins', kind: 'aim', dv: 20 },
  { key: 'vitaminE', label: 'Vitamin E', unit: 'mg', decimals: 1, group: 'Vitamins', kind: 'aim', dv: 15 },
  { key: 'vitaminK', label: 'Vitamin K', unit: 'mcg', decimals: 0, group: 'Vitamins', kind: 'aim', dv: 120 },
  { key: 'thiamin', label: 'Thiamin (B1)', unit: 'mg', decimals: 2, group: 'Vitamins', kind: 'aim', dv: 1.2 },
  { key: 'riboflavin', label: 'Riboflavin (B2)', unit: 'mg', decimals: 2, group: 'Vitamins', kind: 'aim', dv: 1.3 },
  { key: 'niacin', label: 'Niacin (B3)', unit: 'mg', decimals: 1, group: 'Vitamins', kind: 'aim', dv: 16 },
  { key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg', decimals: 2, group: 'Vitamins', kind: 'aim', dv: 1.7 },
  { key: 'folate', label: 'Folate', unit: 'mcg', decimals: 0, group: 'Vitamins', kind: 'aim', dv: 400 },
  { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg', decimals: 1, group: 'Vitamins', kind: 'aim', dv: 2.4 },
  { key: 'choline', label: 'Choline', unit: 'mg', decimals: 0, group: 'Vitamins', kind: 'aim', dv: 550 },
  { key: 'caffeine', label: 'Caffeine', unit: 'mg', decimals: 0, group: 'Other', kind: 'limit' },
  { key: 'alcohol', label: 'Alcohol', unit: 'g', decimals: 1, group: 'Other', kind: 'limit' },
  { key: 'water', label: 'Water in food', unit: 'g', decimals: 0, group: 'Other', kind: 'aim' },
] as const satisfies readonly NutrientDef[]

export type NutrientKey = (typeof DEFS)[number]['key']
export type NutrientInfo = NutrientDef & { key: NutrientKey }

/** Every tracked nutrient with its unit, decimals, group, kind and daily value (when it has one). */
export const NUTRIENTS: readonly NutrientInfo[] = DEFS
export type NutrientValues = Partial<Record<NutrientKey, number>>
export type NutrientDraft = Record<NutrientKey, string>

export const NUTRIENT_KEYS: NutrientKey[] = NUTRIENTS.map((nutrient) => nutrient.key)

/** The five original nutrients: shown by default in the entry form and the diary line. */
export const BASIC_NUTRIENT_KEYS: NutrientKey[] = ['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol']
export const BASIC_NUTRIENTS: readonly NutrientInfo[] = NUTRIENTS.filter((nutrient) => BASIC_NUTRIENT_KEYS.includes(nutrient.key))
/** The rest, shown behind "Show all nutrients". */
export const EXTRA_NUTRIENTS: readonly NutrientInfo[] = NUTRIENTS.filter((nutrient) => !BASIC_NUTRIENT_KEYS.includes(nutrient.key))
export const NUTRIENT_GROUPS: readonly NutrientGroup[] = ['Fats', 'Minerals', 'Vitamins', 'Other']

export const nutrientInfo = (key: NutrientKey): NutrientInfo => NUTRIENTS.find((nutrient) => nutrient.key === key) as NutrientInfo

/** Unit as written on a label: "mcg" is shown as is. */
export const nutrientUnit = (key: NutrientKey): string => nutrientInfo(key).unit

export const emptyNutrientDraft = (): NutrientDraft => Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, ''])) as NutrientDraft

/** Form strings from a stored record; a missing value is an empty box, not "0". */
export const nutrientDraftFrom = (record: NutrientValues | undefined): NutrientDraft => {
  const draft = emptyNutrientDraft()
  for (const key of NUTRIENT_KEYS) {
    const value = record?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) draft[key] = inputText(value)
  }
  return draft
}

/** The valid, non-empty values in a draft. Empty boxes are left out so they stay "not recorded". */
export const nutrientValuesFrom = (draft: NutrientDraft): NutrientValues => {
  const values: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const text = draft[key].trim()
    if (!text) continue
    const parsed = parseDecimal(text)
    if (Number.isFinite(parsed) && parsed >= 0) values[key] = parsed
  }
  return values
}

/** The first box that holds something that is not a number of zero or more, or undefined when all are fine. */
export const invalidNutrient = (draft: NutrientDraft): NutrientInfo | undefined =>
  NUTRIENTS.find((nutrient) => {
    const text = draft[nutrient.key].trim()
    if (!text) return false
    const parsed = parseDecimal(text)
    return !Number.isFinite(parsed) || parsed < 0
  })

export interface NutrientTotal { total: number; foods: number }

/** Totals over eaten entries that recorded each nutrient, with how many foods that covers. Unrecorded nutrients are absent. */
export const sumNutrients = (entries: DiaryEntry[]): Partial<Record<NutrientKey, NutrientTotal>> => {
  const totals: Partial<Record<NutrientKey, NutrientTotal>> = {}
  for (const entry of entries) {
    if (entry.planned) continue
    for (const key of NUTRIENT_KEYS) {
      const value = entry[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const current = totals[key] ?? { total: 0, foods: 0 }
      totals[key] = { total: current.total + value, foods: current.foods + 1 }
    }
  }
  return totals
}
