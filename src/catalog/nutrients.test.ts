import { afterEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../../public/data/usda-common-v2.json?raw'
import tableText from '../../public/data/usda-nutrients-v1.json?raw'
import { NUTRIENT_KEYS } from '../lib/nutrients'
import { catalogNutrientSnapshot, catalogNutrientsPer100g, loadCatalogNutrients, NUTRIENTS_PATH, parseNutrientTable } from './nutrients'
import type { CatalogFood } from './types'

const catalog = JSON.parse(catalogText) as CatalogFood[]
const table = parseNutrientTable(JSON.parse(tableText))
const per100 = (name: string) => {
  const food = catalog.find((item) => item.name === name)
  if (!food) throw new Error(`catalog has no ${name}`)
  return table.per100g(food.id) ?? {}
}

afterEach(() => vi.unstubAllGlobals())

describe('the shipped nutrient table (USDA SR Legacy per 100 g)', () => {
  it('has the same keys as the app model, in the file header', () => {
    expect((JSON.parse(tableText) as { keys: string[] }).keys.sort()).toEqual([...NUTRIENT_KEYS].sort())
  })

  it('has raw banana: potassium 358 mg, vitamin C 8.7 mg, fiber 2.6 g, no cholesterol', () => {
    const banana = per100('Bananas, raw')
    expect(banana.potassium).toBeCloseTo(358, 0)
    expect(banana.vitaminC).toBeCloseTo(8.7, 1)
    expect(banana.fiber).toBeCloseTo(2.6, 1)
    expect(banana.magnesium).toBeCloseTo(27, 0)
    expect(banana.cholesterol).toBe(0)
  })

  it('has whole milk: calcium 113 mg, vitamin D in micrograms, vitamin B12', () => {
    const milk = per100('Milk, whole, 3.25% milkfat, with added vitamin D')
    expect(milk.calcium).toBeCloseTo(113, 0)
    expect(milk.vitaminD).toBeCloseTo(1.3, 1)
    expect(milk.vitaminB12).toBeCloseTo(0.45, 2)
    expect(milk.satFat).toBeCloseTo(1.86, 1)
  })

  it('has raw spinach: iron 2.7 mg, vitamin K 483 mcg, folate 194 mcg DFE, vitamin A 469 mcg RAE', () => {
    const spinach = per100('Spinach, raw')
    expect(spinach.iron).toBeCloseTo(2.7, 1)
    expect(spinach.vitaminK).toBeCloseTo(483, 0)
    expect(spinach.folate).toBeCloseTo(194, 0)
    expect(spinach.vitaminA).toBeCloseTo(469, 0)
    expect(spinach.water).toBeCloseTo(91.4, 1)
  })

  it('has alcohol in beer, and omega-3 in farmed salmon as the sum of ALA, EPA and DHA', () => {
    expect(per100('Alcoholic beverage, beer, regular, all').alcohol).toBeCloseTo(3.9, 1)
    const salmon = per100('Fish, salmon, Atlantic, farmed, raw')
    expect(salmon.omega3).toBeCloseTo(2.11, 1)
    expect(salmon.vitaminD).toBeCloseTo(11, 0)
  })

  it('uses the generic 18:3 row as ALA when the ALA row is missing: olive oil 0.76 g, flaxseed 22.8 g, walnuts 9.08 g', () => {
    expect(per100('Oil, olive, salad or cooking').omega3).toBeCloseTo(0.761, 2)
    expect(per100('Seeds, flaxseed').omega3).toBeCloseTo(22.8, 1)
    expect(per100('Nuts, walnuts, english').omega3).toBeCloseTo(9.08, 1)
    expect(per100('Oil, olive, salad or cooking').monoFat).toBeGreaterThan(70)
  })

  it('leaves a nutrient out when the source never measured it, instead of writing zero', () => {
    const milk = per100('Milk, whole, 3.25% milkfat, with added vitamin D')
    expect(milk).not.toHaveProperty('transFat')
    const withTrans = catalog.filter((food) => table.per100g(food.id)?.transFat !== undefined)
    expect(withTrans.length).toBeGreaterThan(3000)
    expect(withTrans.length).toBeLessThan(catalog.length - 2000)
  })

  it('covers every catalog food the source had nutrient rows for, and nothing else', () => {
    const covered = catalog.filter((food) => table.per100g(food.id) !== undefined)
    expect(covered.length).toBeGreaterThan(7700)
    expect(table.per100g('usda-sr-999999999')).toBeUndefined()
    expect(table.per100g('not-a-catalog-id')).toBeUndefined()
  })

  it('never holds a negative or non-finite value', () => {
    const rows = (JSON.parse(tableText) as { rows: number[][] }).rows
    expect(rows.every((row) => row.slice(2).every((value) => Number.isFinite(value) && value >= 0))).toBe(true)
  })
})

describe('parseNutrientTable', () => {
  it('reads values in key order using the bit mask', () => {
    const parsed = parseNutrientTable({ version: 1, keys: ['fiber', 'sugar', 'sodium'], rows: [[10, 0b101, 3.5, 40]] })
    expect(parsed.per100g('usda-sr-10')).toEqual({ fiber: 3.5, sodium: 40 })
  })

  it('skips keys this build does not know', () => {
    const parsed = parseNutrientTable({ version: 1, keys: ['fiber', 'futureNutrient'], rows: [[10, 0b11, 1, 2]] })
    expect(parsed.per100g('usda-sr-10')).toEqual({ fiber: 1 })
  })

  it('rejects a file with the wrong shape', () => {
    expect(() => parseNutrientTable([{ id: 'x' }])).toThrow(/invalid format/)
    expect(() => parseNutrientTable(null)).toThrow(/invalid format/)
  })
})

describe('loading', () => {
  it('fetches once, by URL, with the browser cache allowed, and reuses the request', async () => {
    const fetchMock = vi.fn(async () => new Response(tableText, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const path = './data/usda-nutrients-test-once.json'
    const [first, second] = await Promise.all([loadCatalogNutrients(path), loadCatalogNutrients(path)])
    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ cache: 'force-cache' }))
  })

  it('does not remember a failed load', async () => {
    const path = './data/usda-nutrients-test-retry.json'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(loadCatalogNutrients(path)).rejects.toThrow(/503/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(tableText, { status: 200 })))
    await expect(loadCatalogNutrients(path)).resolves.toBeDefined()
  })

  it('uses the file the service worker warms', () => {
    expect(NUTRIENTS_PATH).toBe('./data/usda-nutrients-v1.json')
  })
})

describe('catalogNutrientSnapshot', () => {
  it('scales every nutrient to the grams: a 118 g banana has about 422 mg of potassium', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(tableText, { status: 200 })))
    const snapshot = await catalogNutrientSnapshot('usda-sr-173944', 118)
    expect(snapshot.potassium).toBeCloseTo(422.4, 0)
    expect(snapshot.vitaminC).toBeCloseTo(10.3, 1)
    expect(snapshot.fiber).toBeCloseTo(3.1, 1)
    expect(snapshot.caffeine).toBe(0)
  })

  it('is empty, never zeros, when the table cannot load or the grams make no sense', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    expect(await catalogNutrientSnapshot('usda-sr-173944-offline', 118)).toEqual({})
    expect(await catalogNutrientSnapshot('usda-sr-173944', 0)).toEqual({})
    expect(await catalogNutrientSnapshot('usda-sr-173944', Number.NaN)).toEqual({})
  })

  it('per-100 g lookup never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await catalogNutrientsPer100g('usda-sr-1')).toBeUndefined()
  })
})
