import { describe, expect, it } from 'vitest'
import type { Food, RecipeIngredient } from '../types'
import { ingredientFromFood, isRecipe, recipePerServing } from './recipes'

const stamp = '2026-01-01T00:00:00.000Z'
const line = (over: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ name: 'Oats', calories: 300, protein: 10, carbs: 50, fat: 6, ...over })
const food = (over: Partial<Food> = {}): Food => ({ id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp, ...over })

describe('recipePerServing', () => {
  it('is all zero for no ingredients', () => {
    expect(recipePerServing([], 4)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('divides the totals by the number of servings', () => {
    expect(recipePerServing([line(), line({ calories: 100, protein: 2, carbs: 10, fat: 4 })], 4)).toEqual({ calories: 100, protein: 3, carbs: 15, fat: 2.5 })
  })

  it('counts zero, negative, NaN and infinite servings as one', () => {
    const whole = { calories: 300, protein: 10, carbs: 50, fat: 6 }
    expect(recipePerServing([line()], 0)).toEqual(whole)
    expect(recipePerServing([line()], -2)).toEqual(whole)
    expect(recipePerServing([line()], Number.NaN)).toEqual(whole)
    expect(recipePerServing([line()], Infinity)).toEqual(whole)
  })

  it('rounds to a tenth', () => {
    expect(recipePerServing([line({ calories: 100, protein: 1, carbs: 1, fat: 1 })], 3)).toEqual({ calories: 33.3, protein: 0.3, carbs: 0.3, fat: 0.3 })
  })

  it('ignores negative and NaN ingredient values', () => {
    expect(recipePerServing([line({ calories: -500, protein: Number.NaN, carbs: 20, fat: 0 }), line({ calories: 50, protein: 1, carbs: 0, fat: 1 })], 1)).toEqual({ calories: 50, protein: 1, carbs: 20, fat: 1 })
  })

  it('leaves a single ingredient at one serving unchanged', () => {
    expect(recipePerServing([line()], 1)).toEqual({ calories: 300, protein: 10, carbs: 50, fat: 6 })
  })
})

describe('ingredientFromFood', () => {
  it('scales every macro by the quantity and records the source food and quantity', () => {
    expect(ingredientFromFood(food(), 2)).toEqual({ name: 'Oats', calories: 300, protein: 10, carbs: 54, fat: 6, quantity: 2, foodId: 'f1' })
  })

  it('supports fractional quantities with tenth rounding', () => {
    const result = ingredientFromFood(food({ calories: 101, protein: 3.3 }), 0.5)
    expect(result.calories).toBe(50.5)
    expect(result.protein).toBe(1.7)
    expect(result.quantity).toBe(0.5)
  })

  it('treats zero, negative, NaN and Infinity quantities as one', () => {
    for (const bad of [0, -3, Number.NaN, Infinity]) {
      const result = ingredientFromFood(food(), bad)
      expect(result.quantity).toBe(1)
      expect(result.calories).toBe(150)
    }
  })

  it('carries only the snapshot fields, not the rest of the food', () => {
    expect(Object.keys(ingredientFromFood(food(), 1)).sort()).toEqual(['calories', 'carbs', 'fat', 'foodId', 'name', 'protein', 'quantity'])
  })
})

describe('isRecipe', () => {
  it('is false for a plain food and for an empty ingredient list', () => {
    expect(isRecipe(food())).toBe(false)
    expect(isRecipe(food({ ingredients: [] }))).toBe(false)
  })

  it('is true when ingredients are present', () => {
    expect(isRecipe(food({ ingredients: [line()] }))).toBe(true)
  })

  it('is false when ingredients is not an array', () => {
    expect(isRecipe({ ...food(), ingredients: 'x' } as unknown as Food)).toBe(false)
  })
})
