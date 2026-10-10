import { describe, expect, it } from 'vitest'
import type { CatalogFood } from '../catalog/types'
import { calculateRecipe, clampServings, decodeRecipeHash, encodeRecipeHash, recipeLabelHtml, recipeLabelText } from './recipe'

const food = (id: string, name: string, per100g: CatalogFood['per100g'], portions?: CatalogFood['portions']): CatalogFood => ({ id, fdcId: 1, name, category: 'Test', source: 'USDA SR Legacy', per100g, portions })
const catalog = [
  food('usda-test-1', 'Rice, white, cooked', { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }, [['1 cup', 158]]),
  food('usda-test-2', 'Chicken, breast, raw', { calories: 120, protein: 22.5, carbs: 0, fat: 2.6 }, [['1 breast', 174]]),
  food('usda-test-3', 'Oil, olive', { calories: 884, protein: 0, carbs: 0, fat: 100 }, [['1 tbsp', 13.5]]),
]

describe('calculateRecipe', () => {
  it('matches_one_ingredient_per_line_and_splits_totals_by_servings', () => {
    const result = calculateRecipe('2 cups rice\n1 lb chicken breast\n2 tbsp olive oil', 4, catalog)
    expect(result.resolved.map((item) => item.food.id)).toEqual(['usda-test-1', 'usda-test-2', 'usda-test-3'])
    expect(result.resolved.map((item) => item.grams)).toEqual([316, 453.6, 27])
    expect(result.unmatched).toEqual([])
    expect(result.total.calories).toBeCloseTo(316 * 1.3 + 453.6 * 1.2 + 27 * 8.84, 1)
    expect(result.perServing.calories).toBeCloseTo(result.total.calories / 4, 5)
    expect(result.servings).toBe(4)
  })

  it('reports_unmatched_lines_and_skips_removed_ones', () => {
    const result = calculateRecipe('1 cup rice\n1 dragon egg', 1, catalog)
    expect(result.unmatched.map((item) => item.query)).toEqual(['dragon egg'])
    const without = calculateRecipe('1 cup rice\n1 tbsp olive oil', 1, catalog, new Set([0]))
    expect(without.total.calories).toBeCloseTo(13.5 * 8.84, 1)
    expect(without.resolved).toHaveLength(2)
  })

  it('keeps_servings_sane', () => {
    expect(clampServings(0)).toBe(1)
    expect(clampServings(NaN)).toBe(1)
    expect(clampServings(2.6)).toBe(3)
    expect(clampServings(10_000)).toBe(200)
  })
})

describe('recipe hash', () => {
  it('round_trips_the_ingredients_and_servings', () => {
    const hash = encodeRecipeHash('2 cups rice\n1 lb chicken breast', 6)
    expect(decodeRecipeHash(hash)).toEqual({ text: '2 cups rice\n1 lb chicken breast', servings: 6 })
    expect(encodeRecipeHash('   ', 3)).toBe('')
    expect(decodeRecipeHash('#s=3')).toBeUndefined()
    expect(decodeRecipeHash('#i=rice')).toEqual({ text: 'rice', servings: 1 })
  })
})

describe('recipe label', () => {
  const result = calculateRecipe('1 cup rice', 2, catalog)

  it('is_self_contained_html_with_per_serving_numbers_and_a_credit_link', () => {
    const html = recipeLabelHtml(result, 'Plain <rice>')
    expect(html).toContain('Plain &lt;rice&gt; · 2 servings · per serving')
    expect(html).toContain('<td style="padding:6px 0;border-top:1px solid #e4e7ec;font-weight:700;">Calories</td>')
    expect(html).toContain(`${Math.round((158 * 1.3) / 2)} kcal`)
    expect(html).toContain('href="https://nutrienttrack.com/recipe-calories/"')
    expect(html).not.toMatch(/<script|<link|src=|url\(/)
  })

  it('reads_as_plain_text_too', () => {
    const text = recipeLabelText(result, '')
    expect(text.split('\n')[0]).toBe('Recipe · 2 servings')
    expect(text).toContain(`Per serving: ${Math.round((158 * 1.3) / 2)} kcal`)
  })
})
