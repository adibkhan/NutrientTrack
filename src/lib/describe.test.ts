import { describe, expect, it } from 'vitest'
import type { CatalogFood } from '../catalog/types'
import { amountFor, looksLikeDescription, matchFood, resolveDescription, splitDescription } from './describe'

const food = (id: number, name: string, calories: number, portions?: Array<[string, number]>): CatalogFood => ({ id: `usda-sr-${id}`, fdcId: id, name, category: 'Test', source: 'USDA SR Legacy', per100g: { calories, protein: 1, carbs: 1, fat: 1 }, ...(portions ? { portions } : {}) })
const catalog = [
  food(1, 'Egg, whole, cooked, hard-boiled', 155, [['1 cup, chopped', 136], ['1 large', 50]]),
  food(2, 'Egg, whole, raw, fresh', 143, [['1 large', 50]]),
  food(3, 'Bread, whole-wheat, commercially prepared, toasted', 306, [['1 slice', 25]]),
  food(4, 'Beverages, coffee, brewed, prepared with tap water', 1, [['1 fl oz', 29.6], ['1 cup', 237]]),
  food(5, 'Bananas, dehydrated, or banana powder', 346, [['1 tbsp', 6]]),
  food(6, 'Bananas, raw', 89, [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118]]),
  food(7, 'Peanut Butter, smooth (Includes foods for USDA\'s Food Distribution Program)', 588, [['1 cup', 258], ['1 tbsp', 16]]),
  food(8, 'Broccoli, cooked, boiled, drained, without salt', 35, [['1 stalk, medium', 180], ['1 cup, chopped', 156]]),
]

describe('splitDescription', () => {
  it('splits_on_commas_and_joining_words_and_reads_quantities_and_units', () => {
    expect(splitDescription('2 eggs, toast and a coffee').map((item) => [item.quantity, item.unit, item.query])).toEqual([[2, undefined, 'eggs'], [1, undefined, 'toast'], [1, undefined, 'coffee']])
    expect(splitDescription('150g chicken with 1 1/2 cups of rice').map((item) => [item.quantity, item.unit, item.query])).toEqual([[150, 'g', 'chicken'], [1.5, 'cup', 'rice']])
    expect(splitDescription('half avocado + 2 tbsp peanut butter').map((item) => [item.quantity, item.unit, item.query])).toEqual([[0.5, undefined, 'avocado'], [2, 'tbsp', 'peanut butter']])
  })

  it('offers_describe_mode_only_for_meal_like_text', () => {
    expect(looksLikeDescription('2 eggs')).toBe(true)
    expect(looksLikeDescription('eggs and toast')).toBe(true)
    expect(looksLikeDescription('salmon')).toBe(false)
  })
})

describe('matchFood', () => {
  it('uses_aliases_for_common_words_and_ignores_usda_notes_in_parentheses', () => {
    expect(matchFood('eggs', catalog)?.id).toBe('usda-sr-1')
    expect(matchFood('peanut butter', catalog)?.id).toBe('usda-sr-7')
  })

  it('prefers_plain_whole_foods_over_processed_ones_in_word_matches', () => {
    expect(matchFood('banana', catalog)?.id).toBe('usda-sr-6')
    expect(matchFood('nothing like this', catalog)).toBeUndefined()
  })
})

describe('amountFor', () => {
  it('converts_weights_and_uses_household_measures_for_counts', () => {
    const egg = catalog[0]
    expect(amountFor({ text: '', quantity: 2, query: 'eggs' }, egg)).toEqual({ grams: 100, amountLabel: '2 large' })
    expect(amountFor({ text: '', quantity: 3, unit: 'oz', query: 'egg' }, egg).grams).toBe(85.1)
    expect(amountFor({ text: '', quantity: 1, unit: 'cup', query: 'egg' }, egg).grams).toBe(136)
  })

  it('spoons_dense_spreads_and_skips_sizes_that_are_not_the_first_word', () => {
    expect(amountFor({ text: '', quantity: 1, query: 'peanut butter' }, catalog[6])).toEqual({ grams: 16, amountLabel: '1 tbsp' })
    expect(amountFor({ text: '', quantity: 1, query: 'broccoli' }, catalog[7])).toEqual({ grams: 156, amountLabel: '1 cup, chopped' })
    expect(amountFor({ text: '', quantity: 1, query: 'banana' }, catalog[5])).toEqual({ grams: 118, amountLabel: '1 medium' })
  })
})

describe('resolveDescription', () => {
  it('keeps_unmatched_words_for_the_person_to_add_by_hand', () => {
    const { resolved, unmatched } = resolveDescription('2 eggs, toast and a mystery stew', catalog)
    expect(resolved.map((item) => item.food.id)).toEqual(['usda-sr-1', 'usda-sr-3'])
    expect(unmatched.map((item) => item.query)).toEqual(['mystery stew'])
  })
})

describe('recipe lines against the real catalog', async () => {
  const real = (await import('../../public/data/usda-common-v2.json')).default as CatalogFood[]

  it('uses_the_spoon_measure_for_oil_and_the_clove_for_garlic', () => {
    const { resolved, unmatched } = resolveDescription('2 tbsp olive oil\n2 cloves garlic\n1 tsp salt', real)
    expect(unmatched).toEqual([])
    expect(resolved[0]).toMatchObject({ grams: 27, amountLabel: '2 tablespoons' })
    expect(resolved[1].food.name).toBe('Garlic, raw')
    expect(resolved[1]).toMatchObject({ grams: 6, amountLabel: '2 cloves' })
    expect(resolved[2].grams).toBeLessThan(10)
  })

  it('reads_a_can_of_tomatoes_as_the_canned_food', () => {
    const { resolved } = resolveDescription('1 can tomatoes', real)
    expect(resolved[0].food.name).toMatch(/^Tomatoes.*canned/)
    expect(resolved[0]).toMatchObject({ grams: 400, amountLabel: '1 can' })
  })
})
