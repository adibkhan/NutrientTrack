import type { NutrientValues } from './nutrients'

/** Whether a digit string ends in a correct GS1 check digit (EAN-8, UPC-A, EAN-13, GTIN-14 all use the same rule). */
export const hasValidCheckDigit = (digits: string): boolean => {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false
  let sum = 0
  // Counting from the digit left of the check digit, weights alternate 3, 1, 3, 1...
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) sum += Number(digits[index]) * weight
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

/** A barcode number as typed or scanned, or undefined when it cannot be a real product code. */
export const normalizeBarcode = (text: string): string | undefined => {
  const digits = text.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return undefined
  return hasValidCheckDigit(digits) ? digits : undefined
}

export interface BarcodeProduct {
  code: string
  name: string
  brand?: string
  /** Grams in one labelled serving, when the database knows it. */
  servingGrams?: number
  per100g: { calories: number; protein: number; carbs: number; fat: number } & NutrientValues
}

export type BarcodeResult =
  | { kind: 'found'; product: BarcodeProduct }
  | { kind: 'not-found' }
  | { kind: 'no-nutrition' }
  | { kind: 'error'; message: string }

const OPEN_FOOD_FACTS = 'https://world.openfoodfacts.org/api/v2/product'
const TIMEOUT_MS = 8000

const finiteNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** A per-100 g amount that is plausible: a value above 100 g of a nutrient in 100 g of food is bad data. */
const grams100 = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed <= 100 ? parsed : undefined
}

/** Turn Open Food Facts product data into a product, or undefined when it has no usable calorie figure. */
export const productFromOpenFoodFacts = (code: string, product: Record<string, unknown>): BarcodeProduct | undefined => {
  const nutriments = (product.nutriments && typeof product.nutriments === 'object' ? product.nutriments : {}) as Record<string, unknown>
  const kcal = finiteNumber(nutriments['energy-kcal_100g']) ?? (finiteNumber(nutriments['energy_100g']) !== undefined ? (finiteNumber(nutriments['energy_100g']) as number) / 4.184 : undefined)
  if (kcal === undefined || kcal > 900) return undefined
  const name = typeof product.product_name === 'string' ? product.product_name.trim() : ''
  const brand = typeof product.brands === 'string' ? product.brands.split(',')[0].trim() : ''
  const serving = finiteNumber(product.serving_quantity)
  const per100g: BarcodeProduct['per100g'] = {
    calories: Math.round(kcal * 10) / 10,
    protein: grams100(nutriments.proteins_100g) ?? 0,
    carbs: grams100(nutriments.carbohydrates_100g) ?? 0,
    fat: grams100(nutriments.fat_100g) ?? 0,
  }
  const fiber = grams100(nutriments.fiber_100g)
  const sugar = grams100(nutriments.sugars_100g)
  const satFat = grams100(nutriments['saturated-fat_100g'])
  const sodiumG = grams100(nutriments.sodium_100g)
  const cholesterolG = grams100(nutriments.cholesterol_100g)
  if (fiber !== undefined) per100g.fiber = fiber
  if (sugar !== undefined) per100g.sugar = sugar
  if (satFat !== undefined) per100g.satFat = satFat
  if (sodiumG !== undefined) per100g.sodium = Math.round(sodiumG * 1000)
  if (cholesterolG !== undefined) per100g.cholesterol = Math.round(cholesterolG * 1000)
  return {
    code,
    name: name || `Product ${code}`,
    ...(brand ? { brand } : {}),
    ...(serving !== undefined && serving > 0 ? { servingGrams: serving } : {}),
    per100g,
  }
}

/** The product's nutrition for an amount in grams, rounded to two decimals. Nutrients the product did not list stay absent. */
export const scaleProduct = (product: BarcodeProduct, grams: number): { calories: number; protein: number; carbs: number; fat: number } & NutrientValues => {
  const factor = (Number.isFinite(grams) && grams > 0 ? grams : 0) / 100
  const scaled: Record<string, number> = {}
  for (const [key, value] of Object.entries(product.per100g)) if (typeof value === 'number') scaled[key] = Math.round(value * factor * 100) / 100
  return scaled as ReturnType<typeof scaleProduct>
}

/**
 * Look one barcode up on Open Food Facts. This sends the number, and the person's IP address, to that site, so callers
 * must only use it after the person has turned barcode lookup on.
 */
export const lookupBarcode = async (code: string, fetchImpl: typeof fetch = fetch): Promise<BarcodeResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${OPEN_FOOD_FACTS}/${encodeURIComponent(code)}.json?fields=code,product_name,brands,serving_quantity,nutriments`, { signal: controller.signal })
    if (response.status === 404) return { kind: 'not-found' }
    if (!response.ok) return { kind: 'error', message: 'The food database did not answer. Try again, or enter the food by hand.' }
    const body = (await response.json()) as { status?: number; product?: Record<string, unknown> }
    if (body.status !== 1 || !body.product) return { kind: 'not-found' }
    const product = productFromOpenFoodFacts(code, body.product)
    return product ? { kind: 'found', product } : { kind: 'no-nutrition' }
  } catch {
    return { kind: 'error', message: 'Could not reach the food database. Check your connection, or enter the food by hand.' }
  } finally {
    clearTimeout(timer)
  }
}
