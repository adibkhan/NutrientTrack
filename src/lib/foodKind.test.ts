import { describe, expect, it } from 'vitest'
import { foodKind } from './foodKind'

describe('foodKind', () => {
  it('uses_the_catalog_category_first', () => {
    expect(foodKind('Abiyuch, raw', 'Fruits and Fruit Juices')).toBe('fruit')
    expect(foodKind('Beef, chuck eye roll', 'Beef Products')).toBe('meat')
    expect(foodKind('Egg, whole, raw', 'Dairy and Egg Products')).toBe('egg')
    expect(foodKind('Milk, whole', 'Dairy and Egg Products')).toBe('dairy')
  })

  it('reads_words_in_custom_names', () => {
    expect(foodKind('Black coffee')).toBe('drink')
    expect(foodKind('Greek yogurt & berries')).toBe('dairy')
    expect(foodKind('Chicken rice bowl')).toBe('meat')
    expect(foodKind('Egg noodles')).toBe('grain')
    expect(foodKind('Peanut butter toast')).toBe('nut')
    expect(foodKind('Salmon, grilled')).toBe('fish')
    expect(foodKind('Apple')).toBe('fruit')
    expect(foodKind('Watermelon slices')).toBe('fruit')
    expect(foodKind('Iced coffee')).toBe('drink')
  })

  it('matches_whole_words_only_and_falls_back_to_a_meal', () => {
    expect(foodKind('Pepperoni pizza')).toBe('meat')
    expect(foodKind('Grandma special')).toBe('meal')
    expect(foodKind('')).toBe('meal')
  })
})
