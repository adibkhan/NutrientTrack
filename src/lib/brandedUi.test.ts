import { describe, expect, it } from 'vitest'
import { barcodeDigits, brandEnergyText, brandedPortionLabel, brandedPortions, brandsLeadGeneric, isDescribeQuery, isSmallServing, servingAmount, sizeChoices } from './brandedUi'

const row = (over: Partial<{ gtin: string; name: string; brand: string; kcal: number; serving: string; query: string; unit: 'ml'; sizes: number }> = {}) => ({ gtin: '00000000000001', name: 'Vanilla Greek Yogurt', brand: 'Chobani', kcal: 80, serving: '1 container (150 g)', query: 'chobani', ...over })

describe('barcodeDigits', () => {
  it.each([['12345670', '12345670'], ['012345678905', '012345678905'], ['0 12345 67890 5', '012345678905'], ['4006381333931', '4006381333931'], ['10012345678902', '10012345678902'], ['012-345-678-905', '012345678905']])('reads %s', (input, digits) => expect(barcodeDigits(input)).toBe(digits))
  it.each(['1234567', '123456789', '12345678901', '123456789012345', 'abc12345678', '12345678a', '', 'chobani 12345678'])('does not read %s', (input) => expect(barcodeDigits(input)).toBeUndefined())
})

describe('servingAmount', () => {
  it.each([['1 bar (40 g)', 40], ['240 ml', 240], ['2 Tbsp (32 g)', 32], ['3 cookies (34.5 g)', 34.5], ['1 cup (30g)', 30], ['3/4 cup (20g) (age 1-3 year…', 20], ['1 1/3 cup (40 g)', 40]])('%s', (text, grams) => expect(servingAmount(text)).toBe(grams))
  it.each(['', '1 bar', '2 gummies', '1 pkg'])('has none in "%s"', (text) => expect(servingAmount(text)).toBeUndefined())
})

describe('brandEnergyText', () => {
  it('is kcal per serving and the serving text', () => expect(brandEnergyText(row())).toBe('120 kcal per serving · 1 container (150 g)'))
  it('falls back to per 100 g without a serving', () => expect(brandEnergyText(row({ serving: '', kcal: 379.6 }))).toBe('380 kcal per 100 g'))
  it('falls back to per 100 g when the serving text carries no weight', () => expect(brandEnergyText(row({ serving: '1 bar' }))).toBe('80 kcal per 100 g'))
})

describe('brandEnergyText variants', () => {
  it('counts sizes', () => expect(brandEnergyText(row({ sizes: 3 }))).toBe('120 kcal per serving · 1 container (150 g) · 3 sizes'))
  it('names the label when the serving rounds to zero', () => expect(brandEnergyText(row({ kcal: 0.4, serving: '1 tsp (4 g)' }))).toContain('(label)'))
  it('speaks ml for liquids', () => expect(brandEnergyText(row({ unit: 'ml', serving: '1 can (355 ml)', kcal: 40 }))).toContain('ml'))
})

describe('brandedPortionLabel', () => {
  it('turns a bare weight into one serving', () => expect(brandedPortionLabel('150 g')).toBe('1 serving (150 g)'))
  it('keeps a household label', () => expect(brandedPortionLabel('1 cup (30 g)')).toBe('1 cup (30 g)'))
})

describe('brandedPortions', () => {
  it('puts a sane label serving first', () => {
    const out = brandedPortions([['1 cookie (34 g)', 34]], 480, 'g')
    expect(out.index).toBe(0)
    expect(out.portions![0][1]).toBe(34)
  })
  it('defaults to 100 g with the label second only for an absurdly LARGE serving', () => {
    for (const [grams, kcal] of [[1500, 100], [200, 700]] as const) {
      const out = brandedPortions([[`1 x (${grams} g)`, grams]], kcal, 'g')
      expect(out.index).toBe(0)
      expect(out.portions![0][1]).toBe(100)
      expect(out.portions).toHaveLength(2)
    }
  })
  it('never replaces a small serving by 100 g (a seasoning at 12,857 mg of sodium)', () => {
    const out = brandedPortions([['1/4 tsp (0.7 g)', 0.7]], 0, 'g')
    expect(out.portions).toEqual([['1/4 tsp (0.7 g)', 0.7]])
    expect(isSmallServing(0.7)).toBe(true)
    expect(isSmallServing(4.9)).toBe(true)
    expect(isSmallServing(5)).toBe(false)
    expect(isSmallServing(undefined)).toBe(false)
  })
})

describe('isDescribeQuery (review L5)', () => {
  it.each(['2 eggs and a banana', 'chicken and some rice', 'eggs, toast', 'one cup of rice', '2 slices bread', 'a bowl of oatmeal with milk and honey', 'half a can of tuna'])('%s is a description', (text) => expect(isDescribeQuery(text)).toBe(true))
  it.each(['chobani vanilla', 'm&m', '2% milk', '7 up', '365 everyday value peanut butter', 'oreo', 'kind dark chocolate', 'ben and jerrys', 'mac and cheese', 'good and gather', 'chicken and rice'])('%s is a food name', (text) => expect(isDescribeQuery(text)).toBe(false))
})

describe('barcodeDigits with 8 digits (review M4)', () => {
  it('reads an 8 digit code only when it is a valid EAN-8 or UPC-E', () => {
    expect(barcodeDigits('96385074')).toBe('96385074') // EAN-8
    expect(barcodeDigits('04210000')).toBeUndefined()
    expect(barcodeDigits('01234565')).toBe('01234565') // UPC-E of 012345000065
  })
})

describe('sizeChoices (review M8)', () => {
  const product = (gtin: string, label: string, size: number, calories: number) => ({ gtin, per100: { calories, protein: 0, fat: 0, carbs: calories / 4 }, serving: { label, size } })
  it('drops products that are the same size and labels the rest by what differs', () => {
    const out = sizeChoices([product('1', '1 can (355 ml)', 355, 40), product('2', '1 can (355 ml)', 355, 40), product('3', '1 can (355 ml)', 355, 50), product('4', '1 bottle (500 ml)', 500, 40)])
    expect(out.map((item) => item.product.gtin)).toEqual(['1', '3', '4'])
    expect(out.map((item) => item.label)).toEqual(['1 can (355 ml), 142 kcal', '1 can (355 ml), 178 kcal', '1 bottle (500 ml)'])
  })
  it('one distinct size leaves one choice (no picker)', () => expect(sizeChoices([product('1', '1 bar (40 g)', 40, 400), product('2', '1 bar (40 g)', 40, 400)])).toHaveLength(1))
})

describe('brandsLeadGeneric', () => {
  const brands = [{ brand: 'Chobani' }, { brand: "Dave's Killer Bread" }, { brand: 'Nabisco Oreo' }]
  it('leads when the first word is a brand and no generic food answers the whole query', () => {
    expect(brandsLeadGeneric('chobani vanilla', brands, [{ name: 'Vanilla extract' }, { name: 'Ice cream, vanilla' }])).toBe(true)
    expect(brandsLeadGeneric('oreo', [{ brand: 'Nabisco Oreo' }], [])).toBe(true)
    expect(brandsLeadGeneric("dave's bread", brands, [{ name: 'Bread, wheat' }])).toBe(true)
  })
  it('stays below when a generic food answers the query in its first segment', () => {
    expect(brandsLeadGeneric('yogurt', [{ brand: 'Yogurt Land' }], [{ name: 'Yogurt, plain, whole milk' }])).toBe(false)
  })
  it('stays below when the first word is not a brand word', () => {
    expect(brandsLeadGeneric('vanilla chobani', brands, [])).toBe(false)
    expect(brandsLeadGeneric('greek yogurt', brands, [])).toBe(false)
  })
  it('stays below with no brand rows or an empty query', () => {
    expect(brandsLeadGeneric('chobani', [], [])).toBe(false)
    expect(brandsLeadGeneric('  ', brands, [])).toBe(false)
  })
  it('matches a brand word exactly, not as a prefix', () => expect(brandsLeadGeneric('cho', brands, [])).toBe(false))
})
