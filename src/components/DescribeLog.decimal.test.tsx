// Describe-to-log with comma decimals: "1,5 kg" is 1.5 kg, and "2,000 g" is refused instead of read as 0 g.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFood } from '../catalog/types'
import { DescribeLog } from './DescribeLog'
import { calculateRecipe } from '../lib/recipe'
import { resolveDescription, splitDescription } from '../lib/describe'

const food = (id: string, name: string, calories: number): CatalogFood => ({ id, fdcId: 1, name, category: 'Test', source: 'USDA SR Legacy', per100g: { calories, protein: 20, carbs: 0, fat: 3 } } as CatalogFood)
const catalog = [food('usda-chicken', 'Chicken, breast, cooked', 165), food('usda-rice', 'Rice, white, cooked', 130), food('usda-egg', 'Egg, whole, cooked', 150)]

vi.mock('../catalog', () => ({ loadCatalog: vi.fn(() => Promise.resolve([
  { id: 'usda-chicken', fdcId: 1, name: 'Chicken, breast, cooked', category: 'Test', source: 'USDA SR Legacy', per100g: { calories: 165, protein: 20, carbs: 0, fat: 3 } },
  { id: 'usda-rice', fdcId: 2, name: 'Rice, white, cooked', category: 'Test', source: 'USDA SR Legacy', per100g: { calories: 130, protein: 2, carbs: 28, fat: 0 } },
])) }))

afterEach(() => cleanup())

describe('splitDescription', () => {
  it('keeps a decimal comma inside the number', () => {
    const [item] = splitDescription('1,5 kg chicken breast')
    expect(item).toMatchObject({ quantity: 1.5, unit: 'kg', query: 'chicken breast' })
    expect(splitDescription('1,5kg chicken breast')[0]).toMatchObject({ quantity: 1.5, unit: 'kg' })
    expect(splitDescription('0.5 kg rice')[0].quantity).toBe(0.5)
  })
  it('still splits items on commas between words and before numbers', () => {
    expect(splitDescription('2 eggs, toast, coffee').map((item) => item.query)).toEqual(['eggs', 'toast', 'coffee'])
    expect(splitDescription('eggs,toast').map((item) => item.query)).toEqual(['eggs', 'toast'])
    expect(splitDescription('2 eggs,3 toast').map((item) => item.query)).toEqual(['eggs', 'toast'])
    expect(splitDescription('2 eggs, 3 toast').map((item) => item.quantity)).toEqual([2, 3])
  })
  it('marks an ambiguous amount instead of reading it as a small or wrong number', () => {
    const [item] = splitDescription('2,000 g rice')
    expect(item.problem).toMatch(/^“2,000” could mean 2000 or 2\./)
    expect(item.text).toBe('2,000 g rice')
  })
  it('matches nothing for an ambiguous amount', () => {
    const { resolved, unmatched } = resolveDescription('2,000 g rice, 1,5 kg chicken breast', catalog)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].grams).toBe(1500)
    expect(unmatched).toHaveLength(1)
    expect(unmatched[0].problem).toBeTruthy()
  })
})

describe('recipe calculator lines', () => {
  it('reads 1,5 kg as 1500 g and lists 2,000 g as a problem line, not a wrong amount', () => {
    const result = calculateRecipe('1,5 kg chicken breast\n2,000 g rice', 1, catalog)
    expect(result.resolved).toHaveLength(1)
    expect(result.resolved[0].grams).toBe(1500)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0].text).toBe('2,000 g rice')
    expect(result.problems[0].message).toMatch(/could mean 2000 or 2/)
  })
})

describe('DescribeLog', () => {
  it('shows 1,5 kg as 1500 g', async () => {
    render(<DescribeLog text="1,5 kg chicken breast" saving={false} onAdd={() => undefined} />)
    expect(await screen.findByText(/1,500 g/)).toBeTruthy()
  })
  it('says why "2,000 g rice" was not matched', async () => {
    render(<DescribeLog text="2,000 g rice" saving={false} onAdd={() => undefined} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could mean 2000 or 2/)
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull()
  })
})
