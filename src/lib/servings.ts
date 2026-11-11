import type { NutrientValues } from './nutrients'
import { BASIC_NUTRIENT_KEYS, NUTRIENT_KEYS, type NutrientKey } from './nutrients'

/** The nutrition of exactly one serving: the starting point a servings stepper scales from. */
export interface ServingBase {
  calories: number
  protein: number
  carbs: number
  fat: number
  nutrients: NutrientValues
  /** Grams in one serving, when the entry recorded a weight (a barcode product); scaled with the servings. */
  grams?: number
}

type Macros = { calories: number; protein: number; carbs: number; fat: number; grams?: number } & NutrientValues

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
const tidy = (value: number): number => Math.round(value * 100) / 100
/**
 * One nutrient amount rounded for storage: two decimals from 1 up, and below 1 two decimals for the original five and three
 * significant figures for the newer ones. A non-zero amount never rounds to zero, which would read as "none".
 */
export const roundNutrient = (key: NutrientKey, value: number): number => {
  if (!(value > 0)) return value
  if (value >= 1) return tidy(value)
  const twoDecimals = tidy(value)
  if (BASIC_NUTRIENT_KEYS.includes(key) && twoDecimals > 0) return twoDecimals
  return Number(value.toPrecision(3))
}

/** One serving's worth from a record that already covers `servings` servings. A bad or zero count counts as one. */
export const baseFromRecord = (record: Macros, servings = 1): ServingBase => {
  const divisor = Number.isFinite(servings) && servings > 0 ? servings : 1
  const nutrients: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const value = record[key]
    // A nutrient the record never had stays absent: "not recorded" must not become zero by scaling.
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) nutrients[key] = value / divisor
  }
  const grams = typeof record.grams === 'number' && Number.isFinite(record.grams) && record.grams > 0 ? { grams: record.grams / divisor } : {}
  return { calories: finite(record.calories) / divisor, protein: finite(record.protein) / divisor, carbs: finite(record.carbs) / divisor, fat: finite(record.fat) / divisor, nutrients, ...grams }
}

/** The nutrition of `servings` servings, every figure scaled and rounded to two decimals. */
export const scaleBase = (base: ServingBase, servings: number): ServingBase => {
  const factor = Number.isFinite(servings) && servings > 0 ? servings : 0
  const nutrients: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const value = base.nutrients[key]
    if (typeof value === 'number') nutrients[key] = roundNutrient(key, value * factor)
  }
  const grams = base.grams !== undefined ? { grams: Math.round(base.grams * factor * 10) / 10 } : {}
  return { calories: tidy(base.calories * factor), protein: tidy(base.protein * factor), carbs: tidy(base.carbs * factor), fat: tidy(base.fat * factor), nutrients, ...grams }
}

/** Nutrients per 100 g from an amount weighing `grams`; undefined when there is nothing to scale from. */
export const nutrientsPer100g = (nutrients: NutrientValues, grams: number): NutrientValues | undefined => {
  if (!(grams > 0) || !Number.isFinite(grams)) return undefined
  const per100: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const value = nutrients[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) per100[key] = (value / grams) * 100
  }
  return Object.keys(per100).length > 0 ? per100 : undefined
}

/** Nutrients for an amount in grams from per-100 g figures. */
export const scaleNutrientsPer100g = (per100: NutrientValues, grams: number): NutrientValues => {
  const factor = Number.isFinite(grams) && grams > 0 ? grams / 100 : 0
  const scaled: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const value = per100[key]
    if (typeof value === 'number') scaled[key] = roundNutrient(key, value * factor)
  }
  return scaled
}
