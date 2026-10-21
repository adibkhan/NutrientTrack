// Caps and messages for odd recipe input: line limit, 20 kg ceiling, negative and scientific amounts, no Infinity/NaN/exponent in output.
import { describe, expect, it } from 'vitest'
import type { CatalogFood } from '../catalog/types'
import { MAX_INGREDIENT_GRAMS, MAX_LINES, MSG_NEGATIVE, MSG_SCIENTIFIC, MSG_TOO_LARGE, calculateRecipe, recipeLabelHtml, recipeLabelText } from './recipe'

const rice: CatalogFood = { id: 'usda-test-1', fdcId: 1, name: 'Rice, white, cooked', category: 'Test', source: 'USDA SR Legacy', per100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }, portions: [['1 cup', 158]] }
const catalog = [rice]
const clean = (value: string) => {
  expect(value).not.toMatch(/Infinity|NaN|(^|[\s>:"])\d+(\.\d+)?e[+-]?\d+/i)
}

describe('recipe limits', () => {
  it('reads_only_the_first_100_lines_and_reports_the_rest', () => {
    const text = Array.from({ length: 300 }, () => '10 g rice').join('\n')
    const result = calculateRecipe(text, 1, catalog)
    expect(result.resolved).toHaveLength(MAX_LINES)
    expect(result.ignoredLines).toBe(200)
  })

  it('treats_an_ingredient_over_20_kg_as_too_large', () => {
    const result = calculateRecipe('21 kg rice\n100 g rice', 1, catalog)
    expect(result.resolved).toHaveLength(1)
    expect(result.problems).toEqual([{ text: '21 kg rice', message: MSG_TOO_LARGE }])
    expect(MSG_TOO_LARGE).toBe('That amount looks too large')
    expect(calculateRecipe('20 kg rice', 1, catalog).resolved).toHaveLength(1)
    expect(MAX_INGREDIENT_GRAMS).toBe(20_000)
  })

  it('never_produces_infinity_nan_or_exponents_for_absurd_amounts', () => {
    const huge = `1${'0'.repeat(400)} g rice`
    const result = calculateRecipe(`${huge}\n99999999999999999999 g rice\n1e308 g rice\n2 cups rice`, 3, catalog)
    expect(result.resolved).toHaveLength(1)
    expect(result.problems).toHaveLength(3)
    expect(result.problems.map((problem) => problem.message).sort()).toEqual([MSG_SCIENTIFIC, MSG_TOO_LARGE, MSG_TOO_LARGE].sort())
    for (const value of [recipeLabelHtml(result, 'Big'), recipeLabelText(result, 'Big'), JSON.stringify(result.perServing), JSON.stringify(result.total)]) clean(value)
  })

  it('names_negative_and_scientific_amounts_instead_of_no_match', () => {
    const result = calculateRecipe('-2 cups rice\n1e3 g rice\n2.5e2 g rice\n1 cup rice', 1, catalog)
    expect(result.resolved).toHaveLength(1)
    expect(result.unmatched).toEqual([])
    expect(result.problems).toEqual([
      { text: '-2 cups rice', message: MSG_NEGATIVE },
      { text: '1e3 g rice', message: MSG_SCIENTIFIC },
      { text: '2.5e2 g rice', message: MSG_SCIENTIFIC },
    ])
  })
})
