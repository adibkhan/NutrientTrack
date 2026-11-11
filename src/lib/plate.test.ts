import { describe, expect, it } from 'vitest'
import { addToPlate, MAX_PLATE_QTY, plateKey, plateAmounts, plateEntries, plateProblem, plateTotals, reduceInPlate, removeFromPlate, type PlateItem } from './plate'

const bar = { key: 'f:1:1', name: 'Bar', unit: { calories: 210, protein: 20, carbs: 22, fat: 7, foodId: '1', fiber: 3 } }
const banana = { key: 'c:b:118:1', name: 'Banana', unit: { calories: 105.02, protein: 1.29, carbs: 26.95, fat: 0.39, grams: 118, catalogId: 'b', catalogSource: 'USDA SR Legacy' as const } }
const recent2 = { key: 'n:stew|500', name: 'Stew', unit: { calories: 500, protein: 30, carbs: 40, fat: 20, servings: 2 } }

describe('plateKey', () => {
  it('merges a recent with a catalog id into the catalog row, and a recent with a food id into the saved row', () => {
    const fromCatalog = { calories: 105, protein: 1, carbs: 27, fat: 0.4, grams: 118, catalogId: 'b' }
    expect(plateKey('Bananas, raw', fromCatalog)).toBe(plateKey('Bananas, raw (old name)', { ...fromCatalog, catalogSource: 'USDA SR Legacy' as const }))
    expect(plateKey('Banana', { ...fromCatalog, grams: 236 })).not.toBe(plateKey('Banana', fromCatalog))
    expect(plateKey('Bar', { calories: 210, protein: 20, carbs: 22, fat: 7, foodId: '1' })).toBe(plateKey('Protein bar', { calories: 200, protein: 20, carbs: 22, fat: 7, foodId: '1' }))
    expect(plateKey('Bar', { calories: 210, protein: 20, carbs: 22, fat: 7, foodId: '1', servings: 2 })).not.toBe(plateKey('Bar', { calories: 210, protein: 20, carbs: 22, fat: 7, foodId: '1' }))
    expect(plateKey(' Toast ', { calories: 120.4, protein: 0, carbs: 0, fat: 0 })).toBe(plateKey('toast', { calories: 120, protein: 0, carbs: 0, fat: 0 }))
  })
})

describe('plate', () => {
  it('adds a line once and counts further taps', () => {
    let plate: PlateItem[] = []
    plate = addToPlate(plate, bar)
    plate = addToPlate(plate, banana)
    plate = addToPlate(plate, bar)
    expect(plate.map((line) => [line.key, line.qty])).toEqual([['f:1:1', 2], ['c:b:118:1', 1]])
    for (let i = 0; i < 40; i += 1) plate = addToPlate(plate, bar)
    expect(plate[0].qty).toBe(MAX_PLATE_QTY)
  })

  it('reduces to zero and drops the line; removes a line outright', () => {
    let plate = addToPlate(addToPlate([], bar), bar)
    plate = reduceInPlate(plate, 'f:1:1')
    expect(plate[0].qty).toBe(1)
    expect(reduceInPlate(plate, 'f:1:1')).toEqual([])
    expect(removeFromPlate(addToPlate(plate, banana), 'f:1:1').map((line) => line.key)).toEqual(['c:b:118:1'])
  })

  it('scales by the count: servings for foods and recents, grams for catalog lines; missing nutrients stay missing', () => {
    expect(plateAmounts({ ...bar, qty: 1 })).toEqual({ calories: 210, protein: 20, carbs: 22, fat: 7, nutrients: { fiber: 3 } })
    expect(plateAmounts({ ...bar, qty: 3 })).toMatchObject({ calories: 630, servings: 3, nutrients: { fiber: 9 } })
    expect(plateAmounts({ ...banana, qty: 2 })).toMatchObject({ calories: 210, grams: 236 })
    expect(plateAmounts({ ...banana, qty: 2 }).servings).toBeUndefined()
    expect(plateAmounts({ ...recent2, qty: 1 })).toMatchObject({ calories: 500, servings: 2 })
    expect(plateAmounts({ ...recent2, qty: 2 })).toMatchObject({ calories: 1000, servings: 4 })
    expect('fiber' in plateAmounts({ ...banana, qty: 1 }).nutrients).toBe(false)
  })

  it('totals the rounded amounts that will be saved', () => {
    expect(plateTotals([{ ...bar, qty: 2 }, { ...banana, qty: 1 }])).toEqual({ foods: 2, calories: 525, protein: 41.3, carbs: 71, fat: 14.4 })
  })

  it('names the food that is over a cap', () => {
    expect(plateProblem([{ ...bar, qty: 1 }])).toBeUndefined()
    expect(plateProblem([{ ...bar, qty: 1 }, { ...bar, key: 'f:2', name: 'Feast', unit: { ...bar.unit, calories: 6000 }, qty: 2 }])).toMatch(/^Feast: That's more than 10000 kcal/)
  })

  it('builds entries in plate order with staggered createdAt and the target meal, date, time and planned flag', () => {
    let n = 0
    const list = plateEntries([{ ...bar, qty: 1 }, { ...banana, qty: 1 }], { date: '2026-06-11', meal: 'snack', time: '', planned: true }, '2026-06-10T12:00:00.000Z', () => `id${(n += 1)}`)
    expect(list.map((item) => item.id)).toEqual(['id1', 'id2'])
    expect(list.map((item) => item.createdAt)).toEqual(['2026-06-10T12:00:00.000Z', '2026-06-10T12:00:00.001Z'])
    expect(list.every((item) => item.meal === 'snack' && item.date === '2026-06-11' && item.planned === true && !('time' in item) && item.updatedAt === '2026-06-10T12:00:00.000Z')).toBe(true)
    expect(list[0]).toMatchObject({ foodId: '1', fiber: 3 })
    expect(list[1]).toMatchObject({ catalogId: 'b', catalogSource: 'USDA SR Legacy', grams: 118, calories: 105 })
    expect('foodId' in list[1]).toBe(false)
  })
})
