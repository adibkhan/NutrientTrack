import { describe, expect, it, vi } from 'vitest'
import { hasValidCheckDigit, lookupBarcode, normalizeBarcode, productFromOpenFoodFacts, scaleProduct, type BarcodeProduct } from './barcode'

describe('hasValidCheckDigit', () => {
  it('accepts a correct EAN-13', () => expect(hasValidCheckDigit('3017620422003')).toBe(true))
  it('rejects an EAN-13 with a wrong check digit', () => expect(hasValidCheckDigit('3017620422004')).toBe(false))
  it('accepts a correct UPC-A', () => expect(hasValidCheckDigit('036000291452')).toBe(true))
  it('accepts a correct EAN-8', () => expect(hasValidCheckDigit('96385074')).toBe(true))
  it('rejects non-digits, a single digit and empty text', () => {
    expect(hasValidCheckDigit('30176204220a3')).toBe(false)
    expect(hasValidCheckDigit('5')).toBe(false)
    expect(hasValidCheckDigit('')).toBe(false)
  })
})

describe('normalizeBarcode', () => {
  it('strips spaces and dashes', () => expect(normalizeBarcode(' 3017-6204 22003 ')).toBe('3017620422003'))
  it('rejects letters', () => expect(normalizeBarcode('30176204220O3')).toBeUndefined())
  it('rejects lengths other than 8, 12, 13 or 14', () => {
    expect(normalizeBarcode('9638507')).toBeUndefined()
    expect(normalizeBarcode('963850740')).toBeUndefined()
    expect(normalizeBarcode('003017620422003')).toBeUndefined()
  })
  it('rejects a bad check digit', () => expect(normalizeBarcode('3017620422004')).toBeUndefined())
  it('accepts valid 8, 12 and 14 digit codes', () => {
    expect(normalizeBarcode('96385074')).toBe('96385074')
    expect(normalizeBarcode('036000291452')).toBe('036000291452')
    expect(normalizeBarcode('00036000291452')).toBe('00036000291452')
  })
  it('rejects empty text', () => expect(normalizeBarcode('')).toBeUndefined())
})

describe('productFromOpenFoodFacts', () => {
  const code = '3017620422003'
  const base = { product_name: 'Spread', nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 } }

  it('uses energy-kcal_100g', () => {
    expect(productFromOpenFoodFacts(code, base)?.per100g).toMatchObject({ calories: 539, protein: 6.3, carbs: 57.5, fat: 30.9 })
  })
  it('falls back to energy_100g in kJ divided by 4.184', () => {
    expect(productFromOpenFoodFacts(code, { nutriments: { energy_100g: 2092 } })?.per100g.calories).toBe(500)
  })
  it('is undefined when there is no energy', () => {
    expect(productFromOpenFoodFacts(code, { product_name: 'x', nutriments: { proteins_100g: 3 } })).toBeUndefined()
    expect(productFromOpenFoodFacts(code, {})).toBeUndefined()
  })
  it('is undefined above 900 kcal and kept at exactly 900', () => {
    expect(productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 901 } })).toBeUndefined()
    expect(productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 900 } })?.per100g.calories).toBe(900)
  })
  it('accepts zero calories', () => {
    expect(productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 0 } })?.per100g.calories).toBe(0)
  })
  it('parses numeric strings', () => {
    expect(productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': '250', proteins_100g: '12.5' } })?.per100g).toMatchObject({ calories: 250, protein: 12.5 })
  })
  it('drops negative values', () => {
    const per = productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 100, proteins_100g: -4, fiber_100g: -1 } })?.per100g
    expect(per?.protein).toBe(0)
    expect(per).not.toHaveProperty('fiber')
  })
  it('drops nutrients above 100 g per 100 g', () => {
    const per = productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 100, fat_100g: 120, sugars_100g: 101, fiber_100g: 100 } })?.per100g
    expect(per?.fat).toBe(0)
    expect(per).not.toHaveProperty('sugar')
    expect(per?.fiber).toBe(100)
  })
  it('converts sodium and cholesterol from grams to milligrams', () => {
    const per = productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 100, sodium_100g: 0.5, cholesterol_100g: 0.02 } })?.per100g
    expect(per).toMatchObject({ sodium: 500, cholesterol: 20 })
  })
  it('keeps fibre, sugar and saturated fat', () => {
    const per = productFromOpenFoodFacts(code, { nutriments: { 'energy-kcal_100g': 100, fiber_100g: 2, sugars_100g: 3, 'saturated-fat_100g': 4 } })?.per100g
    expect(per).toMatchObject({ fiber: 2, sugar: 3, satFat: 4 })
  })
  it('takes the first comma-separated brand', () => {
    expect(productFromOpenFoodFacts(code, { ...base, brands: 'Nutella, Ferrero' })?.brand).toBe('Nutella')
  })
  it('omits the brand when empty', () => {
    expect(productFromOpenFoodFacts(code, { ...base, brands: '' })).not.toHaveProperty('brand')
  })
  it('names a product after its code when it has no name', () => {
    expect(productFromOpenFoodFacts(code, { nutriments: base.nutriments })?.name).toBe(`Product ${code}`)
    expect(productFromOpenFoodFacts(code, { product_name: '   ', nutriments: base.nutriments })?.name).toBe(`Product ${code}`)
  })
  it('sets servingGrams only when positive', () => {
    expect(productFromOpenFoodFacts(code, { ...base, serving_quantity: 15 })?.servingGrams).toBe(15)
    expect(productFromOpenFoodFacts(code, { ...base, serving_quantity: '30' })?.servingGrams).toBe(30)
    expect(productFromOpenFoodFacts(code, { ...base, serving_quantity: 0 })).not.toHaveProperty('servingGrams')
    expect(productFromOpenFoodFacts(code, { ...base, serving_quantity: -5 })).not.toHaveProperty('servingGrams')
  })
})

describe('scaleProduct', () => {
  const product: BarcodeProduct = { code: 'x', name: 'x', per100g: { calories: 333, protein: 3.33, carbs: 10, fat: 1, sodium: 123 } }
  it('rounds to two decimals', () => {
    expect(scaleProduct(product, 33)).toEqual({ calories: 109.89, protein: 1.1, carbs: 3.3, fat: 0.33, sodium: 40.59 })
  })
  it('leaves absent nutrients absent', () => {
    expect(scaleProduct(product, 50)).not.toHaveProperty('fiber')
  })
  it.each([[0], [-10], [Number.NaN]])('gives zeros for %s grams', (grams) => {
    expect(scaleProduct(product, grams)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 })
  })
})

describe('lookupBarcode', () => {
  const reply = (status: number, body: unknown = {}) => vi.fn((..._args: unknown[]) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response))
  const good = { status: 1, product: { product_name: 'Spread', nutriments: { 'energy-kcal_100g': 539 } } }
  const CODE = '3017620422003'

  it('maps a 404 to not-found', async () => expect(await lookupBarcode(CODE, reply(404))).toEqual({ kind: 'not-found' }))
  it('maps a 500 to an error', async () => expect((await lookupBarcode(CODE, reply(500))).kind).toBe('error'))
  it('maps a status 0 body to not-found', async () => expect(await lookupBarcode(CODE, reply(200, { status: 0 }))).toEqual({ kind: 'not-found' }))
  it('maps status 1 without a product to not-found', async () => expect(await lookupBarcode(CODE, reply(200, { status: 1 }))).toEqual({ kind: 'not-found' }))
  it('maps a product without energy to no-nutrition', async () => {
    expect(await lookupBarcode(CODE, reply(200, { status: 1, product: { product_name: 'x', nutriments: {} } }))).toEqual({ kind: 'no-nutrition' })
  })
  it('returns found for a good product', async () => {
    expect(await lookupBarcode(CODE, reply(200, good))).toMatchObject({ kind: 'found', product: { code: CODE, name: 'Spread' } })
  })
  it('returns an error when fetch rejects', async () => {
    expect((await lookupBarcode(CODE, vi.fn(() => Promise.reject(new Error('offline'))))).kind).toBe('error')
  })
  it('returns an error when the body is not JSON', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ status: 200, ok: true, json: () => Promise.reject(new SyntaxError('bad')) } as Response))
    expect((await lookupBarcode(CODE, fetchImpl)).kind).toBe('error')
  })
  it('requests only the Open Food Facts host with the code in the URL', async () => {
    const fetchImpl = reply(200, good)
    await lookupBarcode(CODE, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.hostname).toBe('world.openfoodfacts.org')
    expect(url.pathname).toContain(CODE)
  })
})
