import type { BrandedSummary } from '../catalog/branded'
import type { CatalogFood } from '../catalog/types'
import { isValidEightDigit } from './barcode'
import { foldText } from './foodSearch'

/** Brand search starts at this many characters, so one or two letters never hit the network. */
export const BRAND_MIN_QUERY = 3
/** Rows shown before "Show more", and the most a search ever lists. */
export const BRAND_ROWS_FIRST = 8
export const BRAND_ROWS_MAX = 30
/** Brand search waits this long after the last keystroke. */
export const BRAND_DEBOUNCE_MS = 350

/**
 * The catalog source a diary entry stores. A branded food keeps its catalogId ("usda-branded-<gtin>") but no source: builds from before
 * branded foods validate catalogSource against two values and refuse a whole backup that holds a third (src/lib/backup.ts), so writing
 * 'USDA Branded' would make every backup with a branded entry unrestorable on an older build. The id alone says where the food came from.
 */
export const storedCatalogSource = (source: CatalogFood['source'] | undefined): Exclude<CatalogFood['source'], 'USDA Branded'> | undefined => (source === 'USDA Branded' ? undefined : source)

/** The digits of a query that is nothing but a barcode (12, 13 or 14 digits; 8 digits only with a valid EAN-8 or UPC-E check digit; spaces and hyphens tolerated), else undefined. */
export const barcodeDigits = (query: string): string | undefined => {
  const text = query.trim()
  if (!/^[\d\s-]+$/.test(text)) return undefined
  const digits = text.replace(/\D/g, '')
  if (digits.length === 8) return isValidEightDigit(digits) ? digits : undefined
  return [12, 13, 14].includes(digits.length) ? digits : undefined
}

/** Grams or millilitres in a serving text such as "1 bar (40 g)" or "240 ml". */
export const servingAmount = (serving: string): number | undefined => {
  // The weight is the first "<number> g" or "<number> ml" in the text, wherever it sits ("1 bar (40 g)", "3/4 cup (20g) (age 1-3 year…").
  const match = /(\d+(?:\.\d+)?)\s*(?:g|ml)\b/i.exec(serving)
  const value = match ? Number(match[1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** What a search row says about energy: kilocalories in one labelled serving (or "0 kcal per serving (label)" when the label rounds to zero), or per 100 g/ml with no serving; "N sizes" when the brand sells several. */
export const brandEnergyText = (row: BrandedSummary): string => {
  const unit = row.unit === 'ml' ? 'ml' : 'g'
  const grams = servingAmount(row.serving)
  const sizes = row.sizes && row.sizes > 1 ? ` · ${row.sizes} sizes` : ''
  if (grams === undefined) return `${Math.round(row.kcal)} kcal per 100 ${unit}${sizes}`
  const perServing = Math.round((row.kcal * grams) / 100)
  return `${perServing} kcal per serving${perServing === 0 && row.kcal > 0 ? ' (label)' : ''}${row.serving ? ` · ${row.serving}` : ''}${sizes}`
}

/** A label serving that is only a weight ("150 g") reads "1 serving (150 g)", so its chip is not "150 g 150 g". */
export const brandedPortionLabel = (label: string): string => (/^\d+(?:\.\d+)?\s*(?:g|ml)$/i.test(label.trim()) ? `1 serving (${label.trim()})` : label)

/** A label serving under this many grams (or ml) is logged by servings, not by grams: a pinch of seasoning, a spray, a sweetener packet. */
export const SMALL_SERVING = 5

/**
 * The household chips of a branded food and which one starts selected. The label serving leads and starts selected, unless it is
 * absurdly large (over 1000, or more than 1200 kcal): then 100 g (or ml) starts and the label chip is second. A small serving is
 * never replaced by 100 g (that logged 12,857 mg of sodium for a seasoning): see isSmallServing.
 */
export const brandedPortions = (portions: Array<[string, number]> | undefined, per100Calories: number, unit: 'g' | 'ml' = 'g'): { portions: Array<[string, number]> | undefined; index: number } => {
  const label = portions?.[0]
  if (!portions || !label) return { portions, index: -1 }
  const entry: [string, number] = [brandedPortionLabel(label[0]), label[1]]
  const absurd = label[1] > 1000 || (per100Calories * label[1]) / 100 > 1200
  return absurd ? { portions: [[`Per 100 ${unit}`, 100], entry], index: 0 } : { portions: [entry], index: 0 }
}

/** True when the label serving is small enough that the food is logged by servings (the grams stay read-only). */
export const isSmallServing = (size: number | undefined): boolean => size !== undefined && size > 0 && size < SMALL_SERVING

/** Text that describes a meal ("2 eggs and a banana", "chicken, rice"): the describe-to-log flow takes it, brand search does not. */
export const isDescribeQuery = (query: string): boolean => {
  const text = query.trim().toLowerCase()
  if (/,/.test(text)) return true
  // "and" alone is not enough: "ben and jerrys" and "mac and cheese" are searches. It needs a quantity beside it.
  if (/\band\b/.test(text) && (/^\d/.test(text) || /\band\s+(?:\d|a|an|some|one|two|three|half)\b/.test(text))) return true
  if (text.split(/\s+/).filter(Boolean).length > 5) return true
  return /^(?:\d+(?:\.\d+)?|\d+\/\d+|a|an|one|two|three|four|five|half)\s+(?:(?:a|an|of)\s+)*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|g|grams?|ml|slices?|pieces?|eggs?|servings?|bowls?|plates?|handfuls?|glass(?:es)?|cans?|bottles?|scoops?|bars?)\b/.test(text)
}

/** The size chips of a product group: products with the same serving and the same per-100 values are one size; labels say what differs. */
export const sizeChoices = <T extends { gtin: string; per100: { calories: number; protein: number; fat: number; carbs: number }; serving?: { label: string; size: number } }>(products: T[]): Array<{ product: T; label: string }> => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const product of products) {
    const key = `${product.serving?.label ?? ''}|${product.serving?.size ?? 0}|${product.per100.calories}|${product.per100.protein}|${product.per100.fat}|${product.per100.carbs}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(product)
  }
  const base = (product: T) => product.serving?.label ?? `${product.per100.calories} kcal per 100`
  const counts = new Map<string, number>()
  for (const product of unique) counts.set(base(product), (counts.get(base(product)) ?? 0) + 1)
  return unique.map((product) => {
    const label = base(product)
    const kcal = product.serving ? Math.round((product.per100.calories * product.serving.size) / 100) : undefined
    return { product, label: (counts.get(label) ?? 0) > 1 && kcal !== undefined ? `${label}, ${kcal} kcal` : label }
  })
}

const words = (text: string): string[] => foldText(text).replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Whether the Brands group goes above the generic USDA results: the first word typed is exactly a word of some result's brand
 * ("chobani yogurt"), and the generic results are weak, meaning none of them answers the whole query in its first segment (the part
 * of a USDA name before the first comma: every query word starts a word there). "oreo" or "chobani vanilla" find no generic food
 * named like that, so the brands lead; "yogurt" does ("Yogurt, plain"), so the generic foods stay first.
 */
export const brandsLeadGeneric = (query: string, brands: ReadonlyArray<Pick<BrandedSummary, 'brand'>>, generic: ReadonlyArray<Pick<CatalogFood, 'name'>>): boolean => {
  const tokens = words(query)
  const first = tokens[0]
  if (!first || brands.length === 0) return false
  if (!brands.some((row) => words(row.brand).includes(first))) return false
  return !generic.some((food) => {
    const segment = words(food.name.split(',')[0] ?? '')
    return tokens.every((token) => segment.some((word) => word.startsWith(token)))
  })
}
