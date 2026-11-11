import type { Food, RecipeIngredient } from '../types'
import { NUTRIENT_KEYS, type NutrientValues } from './nutrients'
import { roundNutrient } from './servings'

export interface RecipeTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

const finite = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

/** Whole-recipe totals divided by the number of servings the recipe makes. Zero servings count as one. */
export const recipePerServing = (ingredients: RecipeIngredient[], servings: number): RecipeTotals => {
  const divisor = servings > 0 && Number.isFinite(servings) ? servings : 1
  const sum = ingredients.reduce(
    (total, line) => ({
      calories: total.calories + finite(line.calories),
      protein: total.protein + finite(line.protein),
      carbs: total.carbs + finite(line.carbs),
      fat: total.fat + finite(line.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )
  // Rounded to a tenth so a saved recipe shows tidy numbers while the entry snapshot stays honest.
  const tidy = (value: number) => Math.round((value / divisor) * 10) / 10
  return { calories: tidy(sum.calories), protein: tidy(sum.protein), carbs: tidy(sum.carbs), fat: tidy(sum.fat) }
}

/**
 * Nutrients per serving, summed like the macros. A nutrient no ingredient recorded stays absent. One that only some ingredients
 * recorded is summed over those (the recipe cannot know the rest), which is how partial data behaves everywhere else.
 */
export const recipeNutrientsPerServing = (ingredients: RecipeIngredient[], servings: number): NutrientValues => {
  const divisor = servings > 0 && Number.isFinite(servings) ? servings : 1
  const totals: NutrientValues = {}
  for (const line of ingredients) {
    for (const key of NUTRIENT_KEYS) {
      const value = line[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) totals[key] = (totals[key] ?? 0) + value
    }
  }
  const result: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const total = totals[key]
    if (total !== undefined) result[key] = roundNutrient(key, total / divisor)
  }
  return result
}

/** An ingredient line for `quantity` servings of a saved food, as a snapshot of that moment. */
export const ingredientFromFood = (food: Food, quantity: number): RecipeIngredient => {
  const amount = quantity > 0 && Number.isFinite(quantity) ? quantity : 1
  const scale = (value: number) => Math.round(value * amount * 10) / 10
  const nutrients: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const value = food[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) nutrients[key] = roundNutrient(key, value * amount)
  }
  return {
    name: food.name,
    ...nutrients,
    calories: scale(food.calories),
    protein: scale(food.protein),
    carbs: scale(food.carbs),
    fat: scale(food.fat),
    quantity: amount,
    foodId: food.id,
  }
}

export const isRecipe = (food: Food): boolean => Array.isArray(food.ingredients) && food.ingredients.length > 0
