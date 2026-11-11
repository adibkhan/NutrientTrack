import { describe, expect, it } from 'vitest'
import type { Food, RecipeIngredient } from '../types'
import { validateBackup } from './backup'
import { ingredientFromFood, recipeNutrientsPerServing } from './recipes'

const stamp = '2026-01-01T00:00:00.000Z'
const line = (over: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ name: 'Item', calories: 100, protein: 1, carbs: 1, fat: 1, ...over })

describe('recipeNutrientsPerServing', () => {
  it('sums each nutrient over the ingredients and divides by the servings', () => {
    const per = recipeNutrientsPerServing([line({ potassium: 400, iron: 2 }), line({ potassium: 200, zinc: 1.2 })], 3)
    expect(per).toEqual({ potassium: 200, iron: 0.667, zinc: 0.4 })
  })

  it('leaves a nutrient absent when no ingredient recorded it, and has no keys for plain ingredients', () => {
    expect(recipeNutrientsPerServing([line(), line()], 2)).toEqual({})
    expect(recipeNutrientsPerServing([line({ fiber: 4 })], 2)).not.toHaveProperty('sodium')
  })

  it('keeps a recorded zero and counts a partly recorded nutrient over the ingredients that have it', () => {
    expect(recipeNutrientsPerServing([line({ sugar: 0 }), line()], 1)).toEqual({ sugar: 0 })
    expect(recipeNutrientsPerServing([line({ calcium: 120 }), line()], 2)).toEqual({ calcium: 60 })
  })

  it('treats zero or bad servings as one and does not round a small amount to zero', () => {
    expect(recipeNutrientsPerServing([line({ thiamin: 0.0037 })], 0)).toEqual({ thiamin: 0.0037 })
  })
})

describe('ingredientFromFood', () => {
  const food = { id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, iron: 2.1, vitaminB12: 0, createdAt: stamp, updatedAt: stamp } as Food

  it('carries the food nutrients scaled by the quantity, and none it lacks', () => {
    const ingredient = ingredientFromFood(food, 2)
    expect(ingredient).toMatchObject({ calories: 300, iron: 4.2, vitaminB12: 0, quantity: 2 })
    expect(ingredient).not.toHaveProperty('calcium')
  })
})

describe('backup validation of ingredient nutrients', () => {
  const backup = (ingredient: Record<string, unknown>) => ({ format: 'nutrienttrack-backup', version: 3, exportedAt: stamp, entries: [], weights: [], settings: [], water: [], measurements: [], symptoms: [], foods: [{ id: 'f', name: 'R', serving: '1', calories: 1, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp, ingredients: [{ name: 'a', calories: 1, protein: 1, carbs: 1, fat: 1, ...ingredient }] }] })
  it('accepts non-negative numbers and rejects others', () => {
    expect(validateBackup(backup({ potassium: 10 }))).toBe(true)
    expect(validateBackup(backup({ potassium: -1 }))).toBe(false)
  })
})
