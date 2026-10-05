import type { Food, RecipeIngredient } from '../types'

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

/** An ingredient line for `quantity` servings of a saved food, as a snapshot of that moment. */
export const ingredientFromFood = (food: Food, quantity: number): RecipeIngredient => {
  const amount = quantity > 0 && Number.isFinite(quantity) ? quantity : 1
  const scale = (value: number) => Math.round(value * amount * 10) / 10
  return {
    name: food.name,
    calories: scale(food.calories),
    protein: scale(food.protein),
    carbs: scale(food.carbs),
    fat: scale(food.fat),
    quantity: amount,
    foodId: food.id,
  }
}

export const isRecipe = (food: Food): boolean => Array.isArray(food.ingredients) && food.ingredients.length > 0
