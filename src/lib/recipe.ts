import type { CatalogFood } from '../catalog/types'
import { resolveDescription, type DescribedItem, type ResolvedItem } from './describe'

/**
 * The recipe calorie calculator page: ingredients typed one per line become catalog foods with gram amounts, the
 * totals are split by servings, and the result can be copied as a plain nutrition label for a blog or a note.
 * Everything runs on the device, on the same matcher as describe-to-log.
 */
export interface RecipeTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface RecipeResult {
  resolved: ResolvedItem[]
  unmatched: DescribedItem[]
  servings: number
  total: RecipeTotals
  perServing: RecipeTotals
}

export const MAX_SERVINGS = 200

export const clampServings = (value: number): number => (Number.isFinite(value) && value >= 1 ? Math.min(MAX_SERVINGS, Math.round(value)) : 1)

const scale = (food: CatalogFood, grams: number): RecipeTotals => ({
  calories: (food.per100g.calories * grams) / 100,
  protein: (food.per100g.protein * grams) / 100,
  carbs: (food.per100g.carbs * grams) / 100,
  fat: (food.per100g.fat * grams) / 100,
})

export const ingredientTotals = (item: ResolvedItem): RecipeTotals => scale(item.food, item.grams)

/** One ingredient per line. Commas inside a line still split, so "salt, pepper" on one line is two ingredients. */
export const calculateRecipe = (text: string, servings: number, catalog: CatalogFood[], skipped: ReadonlySet<number> = new Set()): RecipeResult => {
  const { resolved: all, unmatched } = resolveDescription(text, catalog)
  const resolved = all.filter((_, index) => !skipped.has(index))
  const count = clampServings(servings)
  const total = resolved.reduce<RecipeTotals>((sum, item) => {
    const part = ingredientTotals(item)
    return { calories: sum.calories + part.calories, protein: sum.protein + part.protein, carbs: sum.carbs + part.carbs, fat: sum.fat + part.fat }
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
  const perServing = { calories: total.calories / count, protein: total.protein / count, carbs: total.carbs / count, fat: total.fat / count }
  return { resolved: all, unmatched, servings: count, total, perServing }
}

/** The recipe in the page address, so a link to it brings the same ingredients back: #i=<lines>&s=<servings>. */
export const encodeRecipeHash = (text: string, servings: number): string => {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const params = new URLSearchParams()
  params.set('i', trimmed)
  if (clampServings(servings) !== 1) params.set('s', String(clampServings(servings)))
  return `#${params.toString()}`
}

export const decodeRecipeHash = (hash: string): { text: string; servings: number } | undefined => {
  if (!hash.startsWith('#')) return undefined
  const params = new URLSearchParams(hash.slice(1))
  const text = params.get('i')?.slice(0, 2000)
  if (!text) return undefined
  return { text, servings: clampServings(Number(params.get('s') ?? 1)) }
}

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)

/**
 * A self-contained nutrition label for pasting into a blog post or recipe card: inline styles only, no script, no
 * external assets, and one credit link back to the app. The numbers are per serving.
 */
export const recipeLabelHtml = (result: RecipeResult, title: string, origin = 'https://nutrienttrack.com'): string => {
  const name = title.trim() || 'Recipe'
  const per = result.perServing
  const row = (label: string, value: string, bold = false) => `<tr><td style="padding:6px 0;border-top:1px solid #e4e7ec;${bold ? 'font-weight:700;' : ''}">${label}</td><td style="padding:6px 0;border-top:1px solid #e4e7ec;text-align:right;font-variant-numeric:tabular-nums;${bold ? 'font-weight:700;' : ''}">${value}</td></tr>`
  return [
    `<div style="max-width:320px;padding:14px 16px;border:1px solid #e4e7ec;border-radius:10px;background:#fff;color:#101828;font:14px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif">`,
    `<p style="margin:0 0 2px;font-size:18px;font-weight:700;letter-spacing:-.01em">Nutrition Facts</p>`,
    `<p style="margin:0 0 8px;color:#667085;font-size:13px">${escapeHtml(name)} · ${result.servings} ${result.servings === 1 ? 'serving' : 'servings'} · per serving</p>`,
    `<table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>`,
    row('Calories', `${round(per.calories)} kcal`, true),
    row('Protein', `${round(per.protein, 1)} g`),
    row('Carbohydrate', `${round(per.carbs, 1)} g`),
    row('Fat', `${round(per.fat, 1)} g`),
    `</tbody></table>`,
    `<p style="margin:10px 0 0;color:#667085;font-size:12px">Powered by <a href="${origin}/recipe-calories/" style="color:#2e6fe8;text-decoration:none">NutrientTrack</a> · USDA data, values are estimates</p>`,
    `</div>`,
  ].join('')
}

/** The same label as plain text, for notes and messages. */
export const recipeLabelText = (result: RecipeResult, title: string): string => {
  const per = result.perServing
  return [
    `${title.trim() || 'Recipe'} · ${result.servings} ${result.servings === 1 ? 'serving' : 'servings'}`,
    `Per serving: ${round(per.calories)} kcal · ${round(per.protein, 1)} g protein · ${round(per.carbs, 1)} g carbs · ${round(per.fat, 1)} g fat`,
    `Whole recipe: ${round(result.total.calories)} kcal · ${round(result.total.protein, 1)} g protein · ${round(result.total.carbs, 1)} g carbs · ${round(result.total.fat, 1)} g fat`,
    'Calculated with NutrientTrack (USDA data, estimates).',
  ].join('\n')
}
