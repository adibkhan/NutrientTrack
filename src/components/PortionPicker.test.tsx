import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../../public/data/usda-common-v2.json?raw'
import { PortionPicker, defaultPortionIndex, portionChipLabel } from './PortionPicker'
import type { CatalogFood } from '../catalog/types'

afterEach(cleanup)

const portions: Array<[string, number]> = [['1 large', 50], ['1 medium (7" to 7-7/8" long)', 118], ['1 cup, chopped', 128]]

function Harness({ onPick }: { onPick: (grams: number, label: string) => void }) {
  const [grams, setGrams] = useState(100)
  return <><PortionPicker portions={portions} grams={grams} onPick={(next, label) => { setGrams(next); onPick(next, label) }} /><button type="button" onClick={() => setGrams(42)}>type grams</button></>
}

describe('PortionPicker', () => {
  it('shortens_USDA_size_notes_for_the_chip', () => {
    expect(portionChipLabel('1 medium (7" to 7-7/8" long)')).toBe('1 medium')
    expect(portionChipLabel('1 cup, chopped')).toBe('1 cup, chopped')
  })

  it('sets_one_portion_and_adds_another_on_each_repeat_tap', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<Harness onPick={onPick} />)
    const egg = screen.getByRole('button', { name: /1 large/ })
    await user.click(egg)
    expect(onPick).toHaveBeenLastCalledWith(50, '1 large')
    await user.click(egg)
    expect(onPick).toHaveBeenLastCalledWith(100, '2 × 1 large')
    expect(egg.getAttribute('aria-pressed')).toBe('true')
    expect(egg.textContent).toContain('2×')
    await user.click(screen.getByRole('button', { name: /1 medium/ }))
    expect(onPick).toHaveBeenLastCalledWith(118, '1 medium')
  })

  it('clears_the_selection_when_grams_are_changed_by_hand', async () => {
    const user = userEvent.setup()
    render(<Harness onPick={() => undefined} />)
    const cup = screen.getByRole('button', { name: /1 cup, chopped/ })
    await user.click(cup)
    expect(cup.getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'type grams' }))
    expect(cup.getAttribute('aria-pressed')).toBe('false')
  })
})

const food = (category: string, calories: number, name?: string) => ({ category, name, per100g: { calories, protein: 0, carbs: 0, fat: 0 } })

describe('defaultPortionIndex', () => {
  it('ranks 1 medium over 1 large over other counted units over small servings', () => {
    expect(defaultPortionIndex([['1 cup', 100], ['1 slice', 30], ['1 large', 50], ['1 medium', 44]], food('Fruits', 50))).toBe(3)
    expect(defaultPortionIndex([['1 cup', 100], ['1 slice', 30], ['1 large', 50]], food('Fruits', 50))).toBe(2)
    expect(defaultPortionIndex([['1 cup', 100], ['1 slice', 30]], food('Fruits', 50))).toBe(1)
    expect(defaultPortionIndex([['1 cup', 100], ['2 tbsp', 32]], food('Fruits', 50))).toBe(0)
  })

  it('falls back to 100 g (-1) when nothing is a sensible single portion', () => {
    expect(defaultPortionIndex([['1 cup', 216]], food('Fats and Oils', 884))).toBe(-1)
    expect(defaultPortionIndex([['1 lb', 454], ['1 package', 340], ['1 whole', 800]], food('Meat', 100))).toBe(-1)
    expect(defaultPortionIndex(undefined, food('Meat', 100))).toBe(-1)
  })

  it('matches whole words, so pecans are not cans', () => {
    expect(defaultPortionIndex([['1 cup pecans', 100]], food('Nuts', 100))).toBe(0)
    expect(defaultPortionIndex([['1 can', 355]], food('Beverages', 40))).toBe(0)
    expect(defaultPortionIndex([['1 loaf', 100], ['1 pound', 100]], food('Other', 40))).toBe(-1)
  })

  it('ignores notes in parentheses, except a pre-cooking yield weight', () => {
    expect(defaultPortionIndex([['1 medium (whole, 7" long)', 118]], food('Fruits', 89))).toBe(0)
    expect(defaultPortionIndex([['1 unit (yield from 1 lb ready-to-cook chicken)', 52], ['1 cup, chopped', 140]], food('Poultry', 165))).toBe(1)
  })

  it('allows a cup only at 300 kcal or less, and caps counted units at 500 kcal', () => {
    expect(defaultPortionIndex([['1 cup', 100]], food('Grains', 389))).toBe(-1)
    expect(defaultPortionIndex([['1 cup', 100]], food('Grains', 300))).toBe(0)
    expect(defaultPortionIndex([['1 slice', 100]], food('Baked', 600))).toBe(-1)
  })

  it('ranks tiny counted units (a strawberry) below small servings, but keeps slices and eggs', () => {
    expect(defaultPortionIndex([['1 extra large', 27], ['1 cup, halves', 152]], food('Fruits', 32))).toBe(1)
    expect(defaultPortionIndex([['1 extra large', 27]], food('Fruits', 32))).toBe(0)
    expect(defaultPortionIndex([['1 cup', 100], ['1 slice', 28]], food('Baked', 250))).toBe(1)
    expect(defaultPortionIndex([['1 cup', 100], ['1 egg', 33]], food('Dairy and Egg', 150))).toBe(1)
  })
})

describe('defaultPortionIndex refinements', () => {
  it('uses a tablespoon, teaspoon or pat from 4 g with 15 kcal when nothing else qualifies, a spoon before a pat', () => {
    expect(defaultPortionIndex([['1 pat', 5], ['1 tbsp', 14.2], ['1 cup', 227]], food('Dairy', 717))).toBe(1)
    expect(defaultPortionIndex([['1 tablespoon', 13.5], ['1 cup', 216], ['1 tsp', 4.5]], food('Fats', 884))).toBe(0)
    expect(defaultPortionIndex([['1 tsp', 4.2]], food('Sweets', 387))).toBe(0)
    expect(defaultPortionIndex([['1 tsp', 2]], food('Spices', 250))).toBe(-1)
    expect(defaultPortionIndex([['1 tbsp', 15]], food('Herbs', 10))).toBe(-1)
  })

  it('does not use the spoon pass when a regular portion exists', () => {
    expect(defaultPortionIndex([['1 tbsp', 15], ['1 cup', 240]], food('Sauces', 100))).toBe(1)
  })

  it('treats packaging as a last resort, but still caps it', () => {
    expect(defaultPortionIndex([['1 package', 49]], food('Sweets', 480))).toBe(0)
    expect(defaultPortionIndex([['1 container', 170], ['1 cup', 245]], food('Dairy', 60))).toBe(1)
    expect(defaultPortionIndex([['1 container', 170]], food('Dairy', 59))).toBe(0)
    expect(defaultPortionIndex([['1 can', 165]], food('Fish', 100))).toBe(0)
    expect(defaultPortionIndex([['1 bag', 400]], food('Snacks', 400))).toBe(-1)
    expect(defaultPortionIndex([['1 package', 340]], food('Snacks', 100))).toBe(-1)
  })

  it('allows whole and cake', () => {
    expect(defaultPortionIndex([['3 oz whole', 85]], food('Pork', 117))).toBe(0)
    expect(defaultPortionIndex([['1 snack cake', 71]], food('Baked', 390))).toBe(0)
  })

  it('demotes a lone ounce under 50 g so a larger serving wins (tuna gets 3 oz)', () => {
    expect(defaultPortionIndex([['1 oz', 28.35], ['3 oz', 85], ['1 cup, solid', 154]], food('Fish', 86))).toBe(1)
    expect(defaultPortionIndex([['1 oz', 28.35]], food('Fish', 86))).toBe(0)
  })

  it('allows 1 slice from 8 g with 30 kcal, ahead of a big serving (bacon)', () => {
    expect(defaultPortionIndex([['3 oz', 85], ['1 slice cooked', 8.1]], food('Pork', 541))).toBe(1)
    expect(defaultPortionIndex([['1 slice', 8]], food('Pork', 300))).toBe(0)
    expect(defaultPortionIndex([['1 slice', 8]], food('Pork', 300 / 2))).toBe(-1)
  })

  it('puts 1 large first for whole eggs only', () => {
    expect(defaultPortionIndex([['1 medium', 44], ['1 large', 50]], food('Dairy and Egg', 143, 'Egg, whole, raw, fresh'))).toBe(1)
    expect(defaultPortionIndex([['1 medium', 44], ['1 large', 50]], food('Fruits', 50, 'Apples'))).toBe(0)
  })

  it('counts 0.5 breast as a counted unit', () => {
    expect(defaultPortionIndex([['1 unit (yield from 1 lb ready-to-cook chicken)', 52], ['0.5 breast, bone and skin removed', 86], ['1 cup', 140]], food('Poultry', 187))).toBe(1)
  })
})

describe('defaults over the real catalog', () => {
  const catalog = JSON.parse(catalogText) as CatalogFood[]
  const pick = (id: string) => {
    const item = catalog.find((candidate) => candidate.name === id)
    if (!item) throw new Error(`${id} missing`)
    const index = defaultPortionIndex(item.portions, item)
    return index < 0 ? '100 g' : `${item.portions?.[index][0]} ${item.portions?.[index][1]} g`
  }

  it('never starts a food at 1000 kcal or more, and only energy-dense foods reach 500', () => {
    let over500 = 0
    for (const item of catalog) {
      const index = defaultPortionIndex(item.portions, item)
      const grams = index < 0 ? 100 : (item.portions?.[index][1] ?? 100)
      const kcal = (item.per100g.calories * grams) / 100
      expect(kcal, item.name).toBeLessThan(1000)
      if (kcal >= 500) { over500 += 1; expect(index, item.name).toBe(-1) }
    }
    expect(over500).toBeGreaterThan(0)
  })

  it('falls back to 100 g for about 12% of foods and no more than 100 reach 500 kcal', () => {
    let fallback = 0
    let over500 = 0
    for (const item of catalog) {
      const index = defaultPortionIndex(item.portions, item)
      if (index < 0) fallback += 1
      const kcal = (item.per100g.calories * (index < 0 ? 100 : (item.portions?.[index][1] ?? 100))) / 100
      if (kcal >= 500) over500 += 1
    }
    expect(fallback / catalog.length).toBeGreaterThan(0.1)
    expect(fallback / catalog.length).toBeLessThan(0.13)
    expect(over500).toBeLessThan(100)
  })

  it('gives the reviewed foods their expected default', () => {
    const named = (prefix: string) => {
      const item = catalog.find((candidate) => candidate.name.startsWith(prefix) && candidate.portions)
      if (!item) throw new Error(`${prefix} missing`)
      const index = defaultPortionIndex(item.portions, item)
      return index < 0 ? '100 g' : `${item.portions?.[index][0]}`
    }
    expect(named('Butter, salted')).toBe('1 tbsp')
    expect(named('Oil, olive')).toBe('1 tablespoon')
    expect(named('Salad dressing, mayonnaise, regular')).toBe('1 tbsp')
    expect(named('Hummus, commercial')).toBe('1 tbsp')
    expect(named('Sugars, granulated')).toBe('1 tsp')
    expect(named('Pork, cured, bacon, pre-sliced')).toMatch(/^1 slice/)
    expect(named('Fish, tuna, light, canned in water')).toBe('3 oz')
    expect(named('Egg, whole, raw')).toBe('1 large')
    expect(named('Chicken, broilers or fryers, breast, meat only, cooked')).toMatch(/^0\.5 breast/)
    expect(named('Yogurt, Greek, plain, nonfat')).toBe('1 container')
    expect(named('Tomatoes, red, ripe, raw, year round')).toMatch(/^1 medium/)
    expect(named('Candies, ALMOND JOY')).toMatch(/^1 package/)
    expect(named('Cheese, cheddar')).toMatch(/^1 slice/)
    expect(named('Bread, white, commercially')).toBe('1 slice')
    expect(named('Milk, whole, 3.25%')).toBe('1 cup')
  })

  it('gives the common foods people expect', () => {
    expect(pick('Bananas, raw')).toBe('1 medium (7" to 7-7/8" long) 118 g')
    expect(pick('Peanut Butter, smooth (Includes foods for USDA\'s Food Distribution Program)')).toBe('2 tbsp 32 g')
    expect(pick('Alcoholic beverage, beer, light')).toBe('1 can or bottle (12 fl oz) 354 g')
    expect(pick('Oil, olive, salad or cooking')).toBe('1 tablespoon 13.5 g')
    expect(pick('Beverages, coffee, brewed, breakfast blend')).toBe('1 cup 248 g')
  })
})

describe('PortionPicker default selection', () => {
  const many: Array<[string, number]> = [['1 cup', 100], ['2 tbsp', 30], ['1 slice', 28], ['1 oz', 28], ['1 piece', 20], ['1 bar', 40], ['1 medium', 118]]

  function Preselected({ onPick, index = 0 }: { onPick: (grams: number, label: string) => void; index?: number }) {
    const [grams, setGrams] = useState(many[index][1])
    return <PortionPicker portions={many} grams={grams} defaultIndex={index} onPick={(next, label) => { setGrams(next); onPick(next, label) }} />
  }

  it('shows the default selected, the first tap keeps one, and later taps add another', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<Preselected onPick={onPick} index={1} />)
    const chip = screen.getByRole('button', { name: /2 tbsp/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await user.click(chip)
    expect(onPick).toHaveBeenLastCalledWith(30, '2 tbsp')
    expect(chip.textContent).not.toContain('2×')
    await user.click(chip)
    expect(onPick).toHaveBeenLastCalledWith(60, '2 × 2 tbsp')
  })

  it('makes a default beyond the six chips visible and selected by replacing the last chip', () => {
    render(<Preselected onPick={() => undefined} index={6} />)
    const chip = screen.getByRole('button', { name: /1 medium/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('button')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /1 bar/ })).toBeNull()
  })

  it('selects nothing without a default', () => {
    render(<Harness onPick={() => undefined} />)
    expect(screen.getAllByRole('button').every((button) => button.getAttribute('aria-pressed') !== 'true')).toBe(true)
  })
})
