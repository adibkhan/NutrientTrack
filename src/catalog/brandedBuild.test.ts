// @vitest-environment node
// The branded index builder (scripts/build-usda-branded.mjs and scripts/lib/branded-text.mjs) against a tiny synthetic FoodData
// Central release. Fixtures marked "review" are cases the adversarial review of the first build found.
import { describe, expect, it } from 'vitest'
// @ts-expect-error Node only.
import { gunzipSync } from 'node:zlib'
// @ts-expect-error The script is plain JavaScript.
import * as build from '../../scripts/build-usda-branded.mjs'
// @ts-expect-error The csv reader is plain JavaScript.
import { parseChunk } from '../../scripts/lib/csv-stream.mjs'
import { NUTRIENT_KEYS } from '../lib/nutrients'
import { macros, writeSyntheticRelease, type SyntheticFood } from './brandedTestKit'
import * as client from './branded'

// The build script is untyped JavaScript: call it through any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => any
const f = (name: string) => (build as unknown as Record<string, Fn>)[name] as Fn
const { atwaterEstimate, barcodeDigits, buildOutput, checkDigitFor, cleanBrand, cleanHousehold, cleanName, consumerKeyOfCase, decodeEntities, expandUpcE, fixMojibake, gtinKey, hasValidCheckDigit, householdAmount, isLabelRounded, isLocalKey, loadProducts, normalizeGtin, normalizeServing, roundValue, sanityProblem, searchTokens, servingLabel, summaryServing } = build as unknown as Record<string, Fn>
void [atwaterEstimate, barcodeDigits, buildOutput, checkDigitFor, cleanBrand, cleanHousehold, cleanName, consumerKeyOfCase, decodeEntities, expandUpcE, fixMojibake, gtinKey, hasValidCheckDigit, householdAmount, isLabelRounded, isLocalKey, loadProducts, normalizeGtin, normalizeServing, roundValue, sanityProblem, searchTokens, servingLabel, summaryServing]
const OPTIONAL_NUTRIENTS = (build as unknown as { OPTIONAL_NUTRIENTS: Array<{ key: string }> }).OPTIONAL_NUTRIENTS

type P = { gtin: string; fdc: number; name: string; brand: string; kcal: number; protein: number; fat: number; carbs: number; size: number; unit: string; household?: string; flags: number; opt: Array<number | undefined>; records: number }
const load = async (foods: SyntheticFood[]): Promise<{ products: P[]; stats: Record<string, number> }> => f('loadProducts')(writeSyntheticRelease(foods))
const byFdc = (products: P[], fdc: number) => products.find((product) => product.fdc === fdc)
const optIndex = (key: string) => OPTIONAL_NUTRIENTS.findIndex((spec) => spec.key === key)

describe('csv reader', () => {
  const parse = (text: string, final = true) => { const rows: string[][] = []; const used = parseChunk(text, 0, final, Infinity, (row: string[]) => rows.push(row)); return { rows, used } }
  it('handles quotes, escaped quotes, embedded newlines, CRLF and a missing final newline', () => {
    const { rows } = parse('a,"b ""q"" c","x\ny"\r\n1,2,3\n"",,z')
    expect(rows).toEqual([['a', 'b "q" c', 'x\ny'], ['1', '2', '3'], ['', '', 'z']])
  })
  it('leaves an incomplete trailing row for the next chunk', () => {
    const text = 'a,b\n"c,d'
    const { rows, used } = parse(text, false)
    expect(rows).toEqual([['a', 'b']])
    expect(text.slice(used)).toBe('"c,d')
  })
})

describe('barcodes', () => {
  it('normalises to 14 digits and rejects non-barcodes', () => {
    expect(f('normalizeGtin')('0-12345-67890-5')).toBe('00012345678905')
    expect(f('normalizeGtin')(' 012345678905 ')).toBe('00012345678905')
    expect(f('normalizeGtin')('4006381333931')).toBe('04006381333931')
    for (const bad of ['NIELSENUK0002', '84279810254X', '0000000000', '1234567', '123456789012345']) expect(f('normalizeGtin')(bad)).toBeUndefined()
  })
  it('check digits: GS1 mod 10', () => {
    expect(f('checkDigitFor')('01234567890')).toBe(5)
    expect(f('hasValidCheckDigit')('012345678905')).toBe(true)
    expect(f('hasValidCheckDigit')('012345678906')).toBe(false)
    expect(client.checkDigitFor('01234567890')).toBe(5)
  })
  it('review: an 11-digit code that lost its check digit is filed under the completed code', () => {
    // 49000045253 is Coke Zero without the final 3 of 049000045253? The real UPC-A is 049000045253; the source row had 04900004525.
    const real = '049000045253'
    expect(f('hasValidCheckDigit')(real)).toBe(true)
    const lost = real.slice(0, 11)
    expect(f('gtinKey')(lost)).toEqual({ key: `00${real}`, completed: true })
    // A correct 12-digit code, and a code whose padded form is valid, are never changed.
    expect(f('gtinKey')(real)).toEqual({ key: `00${real}`, completed: false })
    expect(f('gtinKey')('0-49000-04525-3')).toEqual({ key: `00${real}`, completed: false })
    // A 13 or 14-digit code with a wrong check digit is kept as is (no guessing).
    expect(f('gtinKey')('4006381333932').completed).toBe(false)
  })
  it('expands UPC-E in every check-digit-position family, the same as the client', () => {
    expect(f('expandUpcE')('04252614')).toBe('042100005264')
    for (const code of ['01234565', '01234573', '01234581', '01234599', '01234508', '11234565', '04252610', '04252623', '04252635', '04252649', '04252657']) {
      expect(client.expandUpcE(code)).toBe(f('expandUpcE')(code))
    }
    expect(f('expandUpcE')('21234565')).toBeUndefined()
  })
  it('review: store-local codes (UPC number systems 2 and 4, EAN 20-29) are recognised, ordinary codes are not', () => {
    for (const key of ['00212345678904', '00412345678901', '02123456789012', '02912345678901']) { expect(f('isLocalKey')(key), key).toBe(true); expect(client.isLocalKey(key)).toBe(true) }
    for (const key of ['00049000045253', '00041234567890', '00021234567890', '00012345678905', '04006381333931', '00001234567895', '10012345678902']) { expect(f('isLocalKey')(key), key).toBe(false); expect(client.isLocalKey(key)).toBe(false) }
  })
  it('review: a case-level GTIN-14 maps to the consumer code it was derived from', () => {
    const consumer = '00012345678905'
    const body = '001234567890' // first 12 digits of the 13-digit form 0012345678905? build a case code: indicator 1 + 12 digits + check
    void body
    const caseBody = '1' + '012345678905'.slice(0, 12)
    const caseKey = `${caseBody}${f('checkDigitFor')(caseBody)}`
    expect(caseKey).toHaveLength(14)
    expect(f('consumerKeyOfCase')(caseKey)).toBe(`0${caseBody.slice(1)}${f('checkDigitFor')(caseBody.slice(1))}`)
    expect(f('consumerKeyOfCase')(consumer)).toBeUndefined() // indicator 0 is not a case
    expect(f('consumerKeyOfCase')(`${caseBody}${(f('checkDigitFor')(caseBody) + 1) % 10}`)).toBeUndefined() // invalid check digit
    expect(client.consumerKeyOfCase(caseKey)).toBe(f('consumerKeyOfCase')(caseKey))
  })
})

describe('text cleaning', () => {
  it('title-cases shouting but leaves mixed case and brand capitalisation alone', () => {
    expect(f('cleanName')('CAMPBELL\'S SLOW KETTLE SOUP CLAM CHOWDER')).toBe('Campbell\'s Slow Kettle Soup Clam Chowder')
    expect(f('cleanName')('  Kerrygold   Pure Irish Butter ')).toBe('Kerrygold Pure Irish Butter')
    expect(f('cleanName')('KIND Bar Dark Chocolate')).toBe('KIND Bar Dark Chocolate')
    expect(f('cleanName')('BBQ CHICKEN PIZZA WITH THE WORKS')).toBe('BBQ Chicken Pizza with the Works')
    expect(f('cleanName')('CHEEZ-IT 12OZ SNACKS')).toBe('Cheez-It 12oz Snacks')
  })
  it('strips a trailing size only when it is the serving', () => {
    expect(f('cleanName')('KIND BAR DARK CHOCOLATE 40 G', { size: 40, unit: 'g' })).toBe('Kind Bar Dark Chocolate')
    expect(f('cleanName')('Granola 1 OZ', { size: 28, unit: 'g' })).toBe('Granola')
    expect(f('cleanName')('Wesson Vegetable Oil 1 GAL', { size: 15, unit: 'ml' })).toBe('Wesson Vegetable Oil 1 GAL')
    expect(f('cleanName')('Soup 12 OZ', { size: 40, unit: 'g' })).toBe('Soup 12 OZ')
  })
  it('drops a variety that the description repeats', () => {
    expect(f('cleanName')('Kind, Bars, Almond, Almond')).toBe('Kind, Bars, Almond')
    expect(f('cleanName')('Greek Yogurt, Vanilla')).toBe('Greek Yogurt, Vanilla')
  })
  it('review: HTML entities are decoded', () => {
    expect(f('decodeEntities')('Ben &amp; Jerry&#39;s &quot;Chunky&quot; &#x26; Co')).toBe('Ben & Jerry\'s "Chunky" & Co')
    expect(f('decodeEntities')('Mac &amp;amp; Cheese')).toBe('Mac & Cheese')
    expect(f('decodeEntities')('AT&T &unknown; 5 < 6')).toBe('AT&T &unknown; 5 < 6')
    expect(f('cleanName')('KRAFT MAC &AMP; CHEESE')).toBe('Kraft Mac & Cheese')
    expect(f('cleanName')('Caf&eacute; Au Lait')).toBe('Café Au Lait')
  })
  it('review: common mojibake is repaired, valid text is untouched', () => {
    expect(f('fixMojibake')('CafÃ© crÃ¨me')).toBe('Café crème')
    expect(f('fixMojibake')('Donâ€™t')).toBe('Don’t')
    expect(f('fixMojibake')('JalapeÃ±o')).toBe('Jalapeño')
    expect(f('fixMojibake')('Café, jalapeño, Ã alone, Å 5')).toBe('Café, jalapeño, Ã alone, Å 5')
    expect(f('cleanName')('NESTLÃ‰ PURE LIFE')).toBe('Nestlé Pure Life')
  })
  it('falls back to the owner without its corporate suffix', () => {
    expect(f('cleanBrand')('', 'CAMPBELL SOUP COMPANY')).toBe('Campbell Soup')
    expect(f('cleanBrand')('', 'ACME FOODS, INC.')).toBe('Acme Foods')
    expect(f('cleanBrand')('Siggi\'s', 'Icelandic Provisions, Inc.')).toBe('Siggi\'s')
  })
  it('cleans household text', () => {
    expect(f('cleanHousehold')('Amount per serving')).toBeUndefined()
    expect(f('cleanHousehold')('PER CONTAINER')).toBeUndefined()
    expect(f('cleanHousehold')('1 ONZ')).toBe('1 oz')
    expect(f('cleanHousehold')('8 OZA')).toBe('8 fl oz')
    expect(f('cleanHousehold')('2.5 cup | about')).toBe('2.5 cup')
  })
  it('review: the serving label does not repeat a weight the household text already states', () => {
    expect(f('servingLabel')('1 bar', 40, 'g')).toBe('1 bar (40 g)')
    expect(f('servingLabel')('1 Tbsp (15 ml)', 15, 'ml')).toBe('1 Tbsp (15 ml)')
    expect(f('servingLabel')('12 fl oz (355 mL)', 360, 'ml')).toBe('12 fl oz (360 ml)') // the row shows the serving size the form logs
    expect(f('servingLabel')('12 fl oz (355 mL)', 355, 'ml')).toBe('12 fl oz (355 mL)')
    expect(f('servingLabel')('3/4 cup (20g)', 20, 'g')).toBe('3/4 cup (20g)')
    expect(f('servingLabel')('15 chips (28 g)', 28, 'g')).toBe('15 chips (28 g)')
    expect(f('servingLabel')('1 cup', 240, 'g')).toBe('1 cup (240 g)')
    expect(f('servingLabel')(undefined, 30, 'g')).toBe('30 g')
    expect(f('servingLabel')(undefined, 0, 'g')).toBeUndefined()
    expect(client.servingLabel('12 fl oz (355 mL)', 360, 'ml')).toBe('12 fl oz (360 ml)')
    expect(client.servingLabel('1 cup', 240, 'g')).toBe('1 cup (240 g)')
  })
})

describe('tokens', () => {
  it('review: digits and percentages are kept, sizes and units are not', () => {
    expect(searchTokens('365 Everyday Value 2% Milk 12 oz 3.5')).toEqual(['365', 'everyday', 'value', '2%', 'milk'])
    expect(searchTokens('Fage Total 0% Greek Yogurt')).toEqual(['fage', 'total', '0%', 'greek', 'yogurt'])
    expect(searchTokens('7UP Soda, 5 Hour Energy, 100% Juice, 2PK')).toEqual(['7up', 'soda', '5', 'hour', 'energy', '100%', 'juice'])
  })
  it('review: single letters join across & and -, "and" between two letters joins too', () => {
    expect(searchTokens('M&M\'s')).toEqual(['mm', 'mms'])
    expect(searchTokens('m&m')).toEqual(['mm'])
    expect(searchTokens('M and M')).toEqual(['mm'])
    expect(searchTokens('H-E-B Select')).toEqual(['heb', 'select'])
    expect(searchTokens('A&W Root Beer')).toEqual(['aw', 'root', 'beer'])
    expect(searchTokens('A & W')).toEqual(['aw'])
    expect(searchTokens('Salt and Vinegar')).toEqual(['salt', 'vinegar'])
  })
  it('review: adjacent brand words also index as one word', () => {
    expect(f('compoundTokens')('La Croix')).toEqual(['lacroix'])
    expect(f('compoundTokens')('Trader Joe\'s')).toEqual(['traderjo'])
    expect(f('compoundTokens')('Great Value')).toEqual(['greatvalue'])
    expect(f('compoundTokens')('Kind')).toEqual([])
    expect(f('indexTokensOf')('Sparkling Water', 'LaCroix')).toEqual(['sparkling', 'water', 'lacroix'])
  })
  it('folds accents and drops apostrophes, like the client', () => {
    expect(searchTokens('Dave\'s Killer Bread, 21 Whole Grains and Seeds')).toEqual(['dave', 'killer', 'bread', '21', 'whole', 'grain', 'seed'])
    expect(searchTokens('Café Crème Cookies 12 oz 2PK')).toEqual(['cafe', 'creme', 'cooky'])
    expect(searchTokens('Tomatoes, Berries, Boss')).toEqual(['tomato', 'berry', 'boss'])
  })
  it('parity: the client tokeniser, brand compounds and row score agree with the build on a corpus', () => {
    const corpus = ['Dave\'s Killer Bread, 21 Whole Grains and Seeds', 'Café Crème Cookies 12 oz 2PK', 'Berries & Cherries with the Pie', 'Ben & Jerry\'s Ice Cream, 16 fl oz', 'Tomatoes, Potatoes, Boss, Glass',
      'M&M\'s Milk Chocolate', 'm and m', 'H-E-B Unsweet Original Almond Milk', 'A&W Root Beer 6 pack', 'La Croix Sparkling Water 2% 0%', 'Fage Total 0% Greek Yogurt 5.3 oz', '365 Everyday Value', '7UP', 'S&P 500', 'AT&T', 'Kraft Mac & Cheese 3.5 oz', 'Dr Pepper 12 fl oz 12 pk', 'Coca-Cola Zero Sugar 8.5 oz', '2% Reduced Fat Milk 1 gal', 'x y z', 'Pop-Tarts 1.5 oz']
    for (const text of corpus) {
      expect(client.searchTokens(text), text).toEqual(searchTokens(text))
      expect(client.compoundTokens(text), text).toEqual(f('compoundTokens')(text))
    }
    const rows = [
      { nameTokens: ['peanut', 'butter', 'creamy'], brandTokens: ['jif'], brandCore: ['jif'], pop: 5, category: 'peanut butter' },
      { nameTokens: ['butter', 'kernel', 'pea'], brandTokens: ['great', 'value', 'greatvalue'], brandCore: ['great', 'value'], pop: 3, category: 'canned vegetables' },
      { nameTokens: ['chip'], brandTokens: ['lay'], brandCore: ['lay'], pop: 6.5, category: '' },
    ]
    const termSets = [
      [{ variants: ['butter'], prefix: false, generic: true, qualifier: false }],
      [{ variants: ['peanut'], prefix: false, generic: true, qualifier: false }, { variants: ['butter'], prefix: false, generic: true, qualifier: false }],
      [{ variants: ['lay'], prefix: true, generic: false, qualifier: false }],
      [{ variants: ['great'], prefix: false, generic: false, qualifier: false }, { variants: ['value'], prefix: false, generic: false, qualifier: false }],
    ]
    for (const row of rows) for (const terms of termSets) expect(client.rowScore(row, terms)).toBeCloseTo(f('rowScore')(row, terms), 10)
  })
})

describe('serving rules', () => {
  const serving = (size: string, unit: string, household: string, kcal: number) => f('normalizeServing')(size, unit, household, kcal) as { size: number; unit: string; note?: string }
  it('review: unit MG is a mislabelled gram, never divided', () => {
    // fdc 2070311-style row: 61.0 MG "2/3 cup" was served as 0.06 g.
    expect(serving('61', 'MG', '2/3 cup', 350)).toMatchObject({ size: 61, unit: 'g' })
    expect(serving('30', 'mg', '1 tbsp', 400)).toMatchObject({ size: 30, unit: 'g' })
  })
  it('gram and millilitre units pass through', () => {
    expect(serving('40', 'G', '1 bar', 450)).toMatchObject({ size: 40, unit: 'g' })
    expect(serving('355', 'MLT', '1 can', 41)).toMatchObject({ size: 355, unit: 'ml' })
    expect(serving('240', 'ml', '1 cup', 50)).toMatchObject({ size: 240, unit: 'ml' })
  })
  it('review: other units (IU, MC, none) are grams only when plausible', () => {
    expect(serving('28', 'IU', '1 oz', 450)).toMatchObject({ size: 28, unit: 'g', note: 'unitGuessed' })
    expect(serving('30', '', '2 tbsp', 100)).toMatchObject({ size: 30, note: 'unitGuessed' })
    expect(serving('5000', 'IU', '', 300).size).toBe(0) // more than 1000
    expect(serving('900', 'MC', '', 300).size).toBe(0) // 2700 kcal per serving
    expect(serving('0.5', 'IU', '', 300).size).toBe(0) // under 1
  })
  it('review: a household amount that disagrees with serving_size by more than 1.5x wins when plausible', () => {
    // Pepsi can: serving_size 8640 ml, household "1 can (355 ml)".
    expect(serving('8640', 'ml', '1 can (355 ml)', 41)).toMatchObject({ size: 355, unit: 'ml', note: 'fromHousehold' })
    expect(serving('120', 'g', '12 fl oz (355 ml)', 40).note).toBeUndefined() // different kind (volume vs grams): no comparison
    expect(serving('50', 'g', '1 oz (28g)', 300)).toMatchObject({ size: 28, note: 'fromHousehold' })
    expect(serving('30', 'g', '1 oz (28g)', 300)).toMatchObject({ size: 30 }) // within 1.5x
  })
  it('drops a serving that cannot be right', () => {
    expect(serving('8640', 'ml', '', 41)).toMatchObject({ size: 0, note: 'implausible' }) // 3542 kcal
    expect(serving('50', 'g', '1 kg (1000g)', 300)).toMatchObject({ size: 0, note: 'householdDropped' })
    expect(serving('', 'g', '1 bar', 300).size).toBe(0)
  })
  it('reads the amounts a household text states', () => {
    expect(householdAmount('1 can (355 ml)', 'ml')).toBe(355)
    expect(householdAmount('12 fl oz (355 mL)', 'ml')).toBe(355)
    expect(householdAmount('1 oz (28g)', 'g')).toBe(28)
    expect(householdAmount('8 fl oz', 'ml')).toBeCloseTo(236.59, 1)
    expect(householdAmount('2 Tbsp (30 ml)', 'g')).toBeNaN()
    expect(householdAmount('1 cup', 'g')).toBeNaN()
  })
})

describe('sanity filters', () => {
  const problem = (...args: unknown[]) => f('sanityProblem')(...args) as string | undefined
  it('flags each problem', () => {
    expect(problem(903, 0, 50, 0)).toBe('kcalOver902')
    expect(problem(400, 50, 50, 5.1)).toBe('macrosOver105')
    expect(problem(500, 1, 1, 1)).toBe('atwaterMismatch')
    expect(problem(500, 10, 30, 50)).toBeUndefined()
    expect(problem(0, 0, 0, 0)).toBeUndefined()
    expect(problem(20, 0, 0, 10)).toBeUndefined() // a small absolute gap is fine
    expect(problem(85, 0.1, 0, 2.6, { alcohol: 10.5 })).toBeUndefined()
    expect(problem(85, 0.1, 0, 2.6)).toBe('atwaterMismatch')
  })
  it('review: pure fats may reach 935 kcal', () => {
    expect(problem(930, 0, 100, 0)).toBeUndefined()
    expect(problem(936, 0, 100, 0)).toBe('kcalOver902')
    expect(problem(910, 0, 90, 0)).toBe('kcalOver902')
  })
  it('review: macros may sum to 110 g when the serving is 15 g or less', () => {
    expect(problem(680, 20, 50, 38, { servingSize: 10 })).toBeUndefined() // 108 g
    expect(problem(680, 20, 50, 38, { servingSize: 40 })).toBe('macrosOver105')
    expect(problem(690, 20, 50, 41, { servingSize: 10 })).toBe('macrosOver105')
  })
  it('review: the Atwater test counts fibre at 2 kcal/g and sugar alcohols at 2.4, and skips servings under 5 g and 0 kcal labels', () => {
    expect(f('atwaterEstimate')(0, 0, 100, 0, 0, 0)).toBe(400)
    expect(f('atwaterEstimate')(0, 0, 100, 40, 0, 0)).toBe(4 * 60 + 2 * 40)
    expect(f('atwaterEstimate')(0, 0, 100, 0, 50, 0)).toBeCloseTo(4 * 50 + 2.4 * 50, 6)
    // A sugar-free candy: 100 g carbs, 80 g of it polyols, label 240 kcal: passes with polyols, would fail without them.
    expect(problem(240, 0, 0, 100, { polyols: 80 })).toBeUndefined()
    expect(problem(240, 0, 0, 100)).toBe('atwaterMismatch')
    // Fibre bars.
    expect(problem(280, 5, 5, 80, { fiber: 50 })).toBeUndefined()
    // Gum: a 1.7 g stick of 300 kcal/100 g whose macros do not add up is label rounding, not an error.
    expect(problem(300, 0, 0, 0, { servingSize: 1.7 })).toBeUndefined()
    expect(problem(300, 0, 0, 0, { servingSize: 20 })).toBe('atwaterMismatch')
    expect(problem(0, 10, 10, 10, { servingSize: 100 })).toBeUndefined() // label kcal 0
  })
  it('rounds to three significant figures', () => {
    expect(roundValue(123.456)).toBe(123)
    expect(roundValue(1.2345)).toBe(1.23)
    expect(roundValue(0.012345)).toBe(0.0123)
    expect(roundValue(0)).toBe(0)
  })
  it('review: a label that rounds to 0 kcal per serving is flagged for sprays, packets and gum, not for ordinary foods', () => {
    expect(f('isLabelRounded')(0, 0.25, 'Oils Edible', 'Cooking Spray')).toBe(true)
    expect(f('isLabelRounded')(330, 0.8, 'Sugar Substitutes', 'Sweetener packets')).toBe(true)
    expect(f('isLabelRounded')(330, 1, 'Sugar Substitutes', 'Sweetener packets')).toBe(false) // 3.3 kcal does not round to zero
    expect(f('isLabelRounded')(0, 355, 'Soda', 'Zero Cola')).toBe(false)
    expect(f('isLabelRounded')(450, 40, 'Bars', 'Bar')).toBe(false)
    expect(f('isLabelRounded')(0, 0, 'Oils', 'Spray')).toBe(false)
  })
})

const FOODS: SyntheticFood[] = [
  // Three records for one UPC: the newest live one wins; a newer discontinued one makes the whole UPC unservable? No: this one is older.
  { fdc: 1, gtin: '012345678905', brand: 'KIND', name: 'KIND BAR DARK CHOCOLATE 40 G', available: '2020-01-01', nutrients: macros(10, 30, 50, { '1093': 100, '1110': 80, '1235': 12, '1079': 7 }) },
  { fdc: 2, gtin: '012345678905', brand: 'KIND', name: 'OLD NAME', available: '2019-01-01', nutrients: macros(10, 30, 50) },
  { fdc: 4, gtin: '0-12345-67890-5', brand: 'KIND', name: 'KIND BAR DARK CHOCOLATE 40 G', available: '2020-01-01', modified: '2022-05-05', nutrients: macros(11, 30, 50) },
  // The newest record of this UPC is discontinued: the older live record is used.
  { fdc: 3, gtin: '000111222333', name: 'DISCONTINUED NEWER', available: '2022-01-01', discontinued: '2022-06-01', nutrients: macros(10, 30, 50) },
  { fdc: 5, gtin: '000111222333', name: 'GONE OLDER', available: '2019-01-01', nutrients: macros(10, 30, 50) },
  // Energy only in kJ (1062): 1000 kJ = 239 kcal.
  { fdc: 6, gtin: '000222333444', name: 'kJ only soup', nutrients: { '1062': 1000, '1003': 5, '1004': 5, '1005': 40 } },
  // Filters.
  { fdc: 7, gtin: '000333444555', name: 'TOO MANY KCAL', nutrients: { '1008': 950, '1003': 0, '1004': 100, '1005': 0 } },
  { fdc: 8, gtin: '000444555666', name: 'MACROS OVER 105', nutrients: { '1008': 800, '1003': 50, '1004': 50, '1005': 20 } },
  { fdc: 9, gtin: '000555666777', name: 'ATWATER MISMATCH', nutrients: { '1008': 500, '1003': 1, '1004': 1, '1005': 1 } },
  { fdc: 10, gtin: '000666777888', name: 'NO ENERGY NO MACROS', nutrients: { '1003': 5 } },
  { fdc: 11, gtin: '000777888999', name: 'NO CARBS', nutrients: { '1008': 100, '1003': 5, '1004': 5 } },
  { fdc: 12, gtin: '000888999000', name: 'Not American', country: 'New Zealand' },
  { fdc: 13, gtin: 'NIELSENUK0002', name: 'Bad code' },
  // Alcohol energy must not trip the Atwater filter.
  { fdc: 14, gtin: '000999000111', name: 'Red wine', unit: 'ml', size: '150', household: '5 OZA', nutrients: { '1008': 85, '1003': 0.1, '1004': 0, '1005': 2.6, '1018': 10.5 } },
  // UPC-E 04252614 expands to 042100005264.
  { fdc: 15, gtin: '042100005264', brand: 'Hunts', name: 'TOMATO SAUCE', size: '', household: 'Amount per serving', nutrients: macros(1, 0, 8, { '1114': 2.5, '1110': 999 }) },
]

describe('loadProducts on a synthetic release', () => {
  it('keeps one product per UPC with the right rules applied', async () => {
    const { products, stats } = await load(FOODS)
    expect(products.map((product) => product.gtin)).toEqual([...products.map((product) => product.gtin)].sort())
    expect(products.map((product) => product.fdc).sort((a, b) => a - b)).toEqual([4, 5, 6, 14, 15])
    const kind = byFdc(products, 4) as P
    expect(kind.name).toBe('Kind Bar Dark Chocolate')
    expect(kind.protein).toBe(11)
    expect(kind.size).toBe(40)
    expect(kind.household).toBe('1 bar')
    expect(kind.records).toBe(3)
    expect(kind.opt[optIndex('sodium')]).toBe(undefined) // fdc 4 carries only macros: absent, never zero
    expect(stats.droppedNotUS).toBe(1)
    expect(stats.droppedBadGtin).toBe(1)
    expect(stats.upcsNewestDiscontinued).toBe(1)
    expect(stats.energyFromKj).toBe(1)
    expect(stats.dropped_noEnergy).toBe(1)
    expect(stats.dropped_missingMacro).toBe(1)
    expect(stats.dropped_kcalOver902).toBe(1)
    expect(stats.dropped_macrosOver105).toBe(1)
    expect(stats.dropped_atwaterMismatch).toBe(1)
    expect(stats.flaggedServingMissing).toBe(1)
    expect(stats.productsKept).toBe(5)
  })

  it('reads the winning record\'s nutrients: IU conversion, added sugar, kJ, ml, missing serving', async () => {
    const foods = FOODS.map((food) => (food.fdc === 4 ? { ...food, available: '2019-06-01' } : food))
    const { products } = await load(foods)
    const kind = byFdc(products, 1) as P
    expect(kind.opt[optIndex('sodium')]).toBe(100)
    expect(kind.opt[optIndex('vitaminD')]).toBe(2) // 80 IU / 40
    expect(kind.opt[optIndex('addedSugar')]).toBe(12)
    expect(kind.opt[optIndex('fiber')]).toBe(7)
    expect(kind.opt[optIndex('calcium')]).toBeUndefined()
    expect((byFdc(products, 6) as P).kcal).toBe(239)
    const wine = byFdc(products, 14) as P
    expect(wine.unit).toBe('ml')
    expect(wine.flags & 1).toBe(1)
    expect(wine.household).toBe('5 fl oz')
    const sauce = byFdc(products, 15) as P
    expect(sauce.opt[optIndex('vitaminD')]).toBe(2.5) // the mcg row beats the IU row
    expect(sauce.size).toBe(0)
    expect(sauce.household).toBeUndefined()
  })

  it('review M5: an all-zero newest record loses to an older record with values; siblings make a lone all-zero product suspect', async () => {
    const { products, stats } = await load([
      { fdc: 30, gtin: '033333333335', brand: 'COKE', name: 'COLA BOTTLE', available: '2023-01-01', nutrients: macros(0, 0, 0) },
      { fdc: 31, gtin: '033333333335', brand: 'COKE', name: 'COLA BOTTLE', available: '2020-01-01', nutrients: macros(0, 0, 10) },
      { fdc: 32, gtin: '033333333342', brand: 'COKE', name: 'COLA BOTTLE', available: '2023-01-01', nutrients: macros(0, 0, 11), size: '500' },
      { fdc: 33, gtin: '033333333359', brand: 'COKE', name: 'COLA BOTTLE', available: '2023-01-01', nutrients: macros(0, 0, 0), size: '250' },
      { fdc: 34, gtin: '044444444443', brand: 'ZERO', name: 'ZERO WATER', available: '2023-01-01', nutrients: macros(0, 0, 0) },
    ])
    expect(products.find((product) => product.fdc === 31 || product.fdc === 30)?.fdc).toBe(31)
    expect(stats.zeroRecordReplacedByOlder).toBe(1)
    const { ordered, groupSize } = build.assignOrdinals(products)
    const suspect = ordered.filter((product: { suspect?: boolean }) => product.suspect).map((product: { fdc: number }) => product.fdc)
    expect(suspect).toEqual([33]) // 2 of 2 other siblings have values; the genuine zero-calorie water has no siblings
    expect(ordered.find((product: { fdc: number }) => product.fdc === 33).popQ).toBe(0)
    const cola = ordered.find((product: { fdc: number }) => product.fdc === 32)
    expect(groupSize.get(cola!.group)).toBe(2) // the suspect and nothing else is not counted
  })

  it('review M8: identical products are one size', async () => {
    const { products } = await load([
      { fdc: 40, gtin: '055555555552', brand: 'ACME', name: 'SODA CAN', nutrients: macros(0, 0, 10), size: '355', unit: 'ml', household: '1 can' },
      { fdc: 41, gtin: '055555555569', brand: 'ACME', name: 'SODA CAN', nutrients: macros(0, 0, 10), size: '355', unit: 'ml', household: '1 can' },
      { fdc: 42, gtin: '055555555576', brand: 'ACME', name: 'SODA CAN', nutrients: macros(0, 0, 10), size: '473', unit: 'ml', household: '1 can' },
    ])
    const { ordered, groupSize } = build.assignOrdinals(products)
    expect(groupSize.get(ordered[0]!.group)).toBe(2)
  })

  it('review L7: folate is DFE (1190), else total folate (1177)', async () => {
    const { products } = await load([
      { fdc: 50, gtin: '066666666661', brand: 'ACME', name: 'DFE', nutrients: macros(5, 5, 20, { '1190': 200, '1177': 120 }) },
      { fdc: 51, gtin: '066666666678', brand: 'ACME', name: 'TOTAL ONLY', nutrients: macros(5, 5, 20, { '1177': 120 }) },
    ])
    const at = build.OPTIONAL_NUTRIENTS.findIndex((spec: { key: string }) => spec.key === 'folate')
    expect(products.find((product: { fdc: number }) => product.fdc === 50)!.opt[at]).toBe(200)
    expect(products.find((product: { fdc: number }) => product.fdc === 51)!.opt[at]).toBe(120)
  })

  it('review: when the newest record fails a check, the next newest live record is kept (6,326 rescuable UPCs)', async () => {
    const { products, stats } = await load([
      { fdc: 20, gtin: '011111111114', brand: 'ACME', name: 'NEWEST BROKEN', available: '2023-01-01', nutrients: { '1008': 900, '1003': 0, '1004': 1, '1005': 1 } },
      { fdc: 21, gtin: '011111111114', brand: 'ACME', name: 'OLDER GOOD', available: '2021-01-01', nutrients: macros(5, 5, 20) },
      { fdc: 22, gtin: '011111111114', brand: 'ACME', name: 'OLDEST', available: '2019-01-01', nutrients: macros(6, 6, 21) },
      { fdc: 23, gtin: '022222222226', brand: 'ACME', name: 'ALL BROKEN', available: '2023-01-01', nutrients: { '1008': 900, '1003': 0, '1004': 1, '1005': 1 } },
    ])
    expect(products.map((product) => product.fdc)).toEqual([21])
    expect(stats.rescuedByOlderRecord).toBe(1)
    expect(stats.dropped_atwaterMismatch).toBe(1)
  })

  it('review: a UPC whose newest record is discontinued is kept from its newest live record, else from its newest discontinued one, and flagged', async () => {
    const { products, stats } = await load([
      { fdc: 30, gtin: '011111111114', name: 'DISCONTINUED NEWEST', available: '2023-01-01', discontinued: '2023-06-01', nutrients: macros(5, 5, 20) },
      { fdc: 31, gtin: '011111111114', name: 'LIVE OLDER', available: '2020-01-01', nutrients: macros(5, 5, 20) },
      { fdc: 32, gtin: '022222222226', name: 'LIVE NEWEST', available: '2023-01-01', nutrients: macros(5, 5, 20) },
      { fdc: 33, gtin: '022222222226', name: 'DISCONTINUED OLDER', available: '2020-01-01', discontinued: '2020-06-01', nutrients: macros(5, 5, 20) },
      // Every record discontinued: the newest one that passes the checks.
      { fdc: 34, gtin: '033333333338', name: 'ALL GONE NEWEST BAD', available: '2023-01-01', discontinued: '2023-06-01', nutrients: { '1008': 950, '1003': 0, '1004': 10, '1005': 0 } },
      { fdc: 35, gtin: '033333333338', name: 'ALL GONE OLDER GOOD', available: '2021-01-01', discontinued: '2021-06-01', nutrients: macros(5, 5, 20) },
      { fdc: 36, gtin: '033333333338', name: 'ALL GONE OLDEST', available: '2019-01-01', discontinued: '2019-06-01', nutrients: macros(5, 5, 20) },
    ])
    const flagOf = (fdc: number) => ((byFdc(products, fdc) as P).flags & 4) !== 0
    expect(products.map((product) => product.fdc).sort((a, b) => a - b)).toEqual([31, 32, 35])
    expect(flagOf(31)).toBe(true) // the newest record of the barcode is discontinued
    expect(flagOf(32)).toBe(false)
    expect(flagOf(35)).toBe(true)
    expect(stats.upcsNewestDiscontinued).toBe(2)
    expect(stats.keptFromDiscontinuedRecord).toBe(1)
  })

  it('review: zero-calorie drinks with absent macro rows are kept (Coke Zero 049000045253: kcal 0, P 0, F 0, carbs absent)', async () => {
    const { products, stats } = await load([
      { fdc: 40, gtin: '049000045253', brand: 'COCA-COLA ZERO SUGAR', name: 'ZERO CALORIE COLA', size: '360', unit: 'ml', household: '12 OZA', nutrients: { '1008': 0, '1003': 0, '1004': 0, '2000': 0 } },
      { fdc: 41, gtin: '070734527449', brand: 'CELESTIAL SEASONINGS', name: 'CARAMEL APPLE TEA BAGS', size: '2', household: '1 TEA BAG', nutrients: { '1003': 0, '1004': 0, '1005': 0 } },
      { fdc: 42, gtin: '016571910372', brand: 'Sparkling Ice', name: 'Pink Grapefruit', size: '503', unit: 'MLT', household: 'Per 1 Bottle', nutrients: { '1003': 0, '1004': 0, '1005': 0 } },
      // 120 kcal with a missing macro is still dropped.
      { fdc: 43, gtin: '011111111114', name: 'HALF A LABEL', nutrients: { '1008': 120, '1003': 5, '1004': 5 } },
    ])
    expect(products.map((product) => product.fdc)).toEqual([42, 40, 41]) // GTIN order
    const coke = byFdc(products, 40) as P
    expect(coke).toMatchObject({ kcal: 0, protein: 0, fat: 0, carbs: 0 })
    expect(stats.macrosAssumedZero).toBe(1)
    expect(stats.dropped_missingMacro).toBe(1)
  })

  it('review: energy absent but protein, fat and carbs present: energy is derived with the Atwater estimate', async () => {
    const { products, stats } = await load([{ fdc: 50, gtin: '011111111114', name: 'NO ENERGY ROW', nutrients: { '1003': 10, '1004': 10, '1005': 20, '1079': 5 } }])
    expect((products[0] as P).kcal).toBe(roundValue(4 * 10 + 4 * 15 + 2 * 5 + 9 * 10))
    expect(stats.energyDerivedFromMacros).toBe(1)
  })

  it('review: sugar alcohols (1086) and fibre are read for the Atwater test; pure oil may reach 935 kcal', async () => {
    const { products, stats } = await load([
      { fdc: 60, gtin: '011111111114', name: 'SUGAR FREE CANDY', size: '40', nutrients: { '1008': 240, '1003': 0, '1004': 0, '1005': 100, '1086': 80 } },
      { fdc: 61, gtin: '022222222226', name: 'OIL', size: '14', unit: 'ml', nutrients: { '1008': 925, '1003': 0, '1004': 100, '1005': 0 } },
      { fdc: 62, gtin: '033333333338', name: 'REALLY MISMATCHED', size: '40', nutrients: { '1008': 240, '1003': 0, '1004': 0, '1005': 100 } },
    ])
    expect(products.map((product) => product.fdc)).toEqual([60, 61])
    expect(stats.dropped_atwaterMismatch).toBe(1)
  })

  it('review: serving rules applied to records (MG as grams, Pepsi can 8640 ml, IU guess, label rounded flag)', async () => {
    const { products, stats } = await load([
      { fdc: 70, gtin: '011111111114', name: 'RICE', size: '61', unit: 'MG', household: '2/3 cup', nutrients: macros(7, 1, 80) },
      { fdc: 71, gtin: '022222222226', name: 'PEPSI', size: '8640', unit: 'ml', household: '1 can (355 ml)', nutrients: macros(0, 0, 10.4) },
      { fdc: 72, gtin: '033333333338', name: 'OATS', size: '40', unit: 'IU', household: '1/2 cup', nutrients: macros(13, 7, 66) },
      { fdc: 73, gtin: '044444444440', brand: 'PAM', name: 'COOKING SPRAY', size: '0.25', household: '1/4 second spray', category: 'Oils Edible', nutrients: { '1008': 0, '1003': 0, '1004': 0, '1005': 0 } },
      { fdc: 74, gtin: '055555555552', brand: 'SPLENDA', name: 'SWEETENER PACKETS', size: '0.8', household: '1 packet', category: 'Sugar Substitutes', nutrients: macros(0, 0, 82) },
    ])
    const get = (fdc: number) => byFdc(products, fdc) as P
    expect(get(70)).toMatchObject({ size: 61, unit: 'g' })
    expect(get(71)).toMatchObject({ size: 355, unit: 'ml' })
    expect(get(72)).toMatchObject({ size: 40, unit: 'g' })
    expect(get(73).flags & 2).toBe(2)
    expect(get(73).kcal).toBe(0) // the label values are kept
    expect(get(74).flags & 2).toBe(2)
    expect(get(70).flags & 2).toBe(0)
    expect(stats.serving_mgTreatedAsGrams).toBe(1)
    expect(stats.serving_fromHousehold).toBe(1)
    expect(stats.serving_unitGuessed).toBe(1)
    expect(stats.labelRounded).toBe(2)
  })

  it('refuses a release whose nutrient units changed', async () => {
    const dir = writeSyntheticRelease(FOODS)
    // @ts-expect-error Node only.
    const { readFileSync, writeFileSync } = await import('node:fs')
    writeFileSync(`${dir}/nutrient.csv`, readFileSync(`${dir}/nutrient.csv`, 'utf8').replace('"1093","n1093","MG"', '"1093","n1093","G"'))
    await expect(f('loadProducts')(dir)).rejects.toThrow(/1093/)
  })

  it('mask keys are a subset of the app nutrient keys (plus addedSugar) and in an order that never changes', () => {
    const keys = OPTIONAL_NUTRIENTS.map((spec) => spec.key)
    expect(keys.filter((key) => !(NUTRIENT_KEYS as string[]).includes(key))).toEqual(['addedSugar'])
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.slice(0, 6)).toEqual(['fiber', 'sugar', 'satFat', 'monoFat', 'polyFat', 'transFat'])
    expect(keys.at(-1)).toBe('addedSugar')
  })
})

describe('barcode keys on a synthetic release', () => {
  it('review: a record with a lost check digit joins the correctly keyed record, the newer one wins', async () => {
    const { products, stats } = await load([
      { fdc: 80, gtin: '049000045253', brand: 'COCA-COLA', name: 'OLD CORRECT', available: '2019-01-01', nutrients: macros(0, 0, 10) },
      { fdc: 81, gtin: '04900004525', brand: 'COCA-COLA', name: 'NEWER LOST DIGIT', available: '2022-01-01', nutrients: macros(0, 0, 11) },
      { fdc: 82, gtin: '04900004527', brand: 'ACME', name: 'LOST DIGIT ALONE', available: '2022-01-01', nutrients: macros(0, 0, 12) },
    ])
    expect(products.map((product) => `${product.gtin}:${product.fdc}`)).toEqual(['00049000045253:81', '00049000045277:82'])
    expect(stats.checkDigitCompleted).toBe(2)
    expect((products[0] as P).records).toBe(2)
  })

  it('review: a UPC-E record merges into its UPC-A twin; a UPC-E without a twin keeps its own key', async () => {
    const { products, stats } = await load([
      { fdc: 90, gtin: '042100005264', brand: 'HUNTS', name: 'TOMATO SAUCE', available: '2019-01-01', nutrients: macros(1, 0, 8) },
      { fdc: 91, gtin: '04252614', brand: 'HUNTS', name: 'TOMATO SAUCE NEWER', available: '2022-01-01', nutrients: macros(1, 0, 9) },
      { fdc: 92, gtin: '01234565', brand: 'LONELY', name: 'UPC-E ALONE', nutrients: macros(1, 0, 9) },
    ])
    expect(products.map((product) => `${product.gtin}:${product.fdc}`)).toEqual(['00000001234565:92', '00042100005264:91'])
    expect(stats.upcEMerged).toBe(1)
  })

  it('review: store-local codes are searchable only with a brand', async () => {
    const { products, stats } = await load([
      { fdc: 100, gtin: '2123456789040', brand: 'DELI CO', name: 'SLICED HAM', nutrients: macros(20, 5, 1) },
      { fdc: 101, gtin: '2123456789057', owner: '', brand: '', name: 'MYSTERY MEAT', nutrients: macros(20, 5, 1) },
      { fdc: 102, gtin: '212345000014', brand: 'BUTCHER', name: 'STEAK', nutrients: macros(20, 5, 1) },
    ])
    expect(products.map((product) => product.fdc)).toEqual([102, 100])
    expect(stats.dropped_localCodeNoBrand).toBe(1)
    expect(stats.localCodesKept).toBe(2)
  })

  it('review: a case-level GTIN-14 with no consumer entry is filed under the consumer code; with one, it keeps its own', async () => {
    const body = '1' + '04900004525'.padStart(12, '0').slice(0, 12)
    const caseKey = `${body}${f('checkDigitFor')(body)}`
    const consumerBody = body.slice(1)
    const consumer = `0${consumerBody}${f('checkDigitFor')(consumerBody)}`
    const both = await load([
      { fdc: 110, gtin: caseKey, brand: 'COCA-COLA', name: 'CASE ONLY', nutrients: macros(0, 0, 10) },
    ])
    expect(both.products.map((product) => product.gtin)).toEqual([consumer])
    expect(both.stats.caseRekeyed).toBe(1)
    const twin = await load([
      { fdc: 111, gtin: caseKey, brand: 'COCA-COLA', name: 'CASE', nutrients: macros(0, 0, 10) },
      { fdc: 112, gtin: consumer.slice(1), brand: 'COCA-COLA', name: 'CONSUMER', nutrients: macros(0, 0, 10) },
    ])
    expect(twin.products.map((product) => product.gtin).sort()).toEqual([caseKey, consumer].sort())
  })
})

describe('buildOutput', () => {
  const small = { detailRawBytes: 100, blockRows: 2, headMin: 1, headRows: 3 }

  it('is deterministic and every shard is where the manifest says', async () => {
    const { products, stats } = await load(FOODS)
    const first = f('buildOutput')(products, stats, small)
    const second = f('buildOutput')(products, stats, small)
    expect(Object.keys(first.files)).toEqual(Object.keys(second.files))
    const text = (content: Uint8Array | string) => new TextDecoder('latin1').decode(typeof content === 'string' ? new TextEncoder().encode(content) : content)
    for (const name of Object.keys(first.files)) expect(text(first.files[name]) === text(second.files[name])).toBe(true)
    expect(first.manifest.detail.starts.length).toBeGreaterThan(1)
    expect(first.manifest.summaries.places.length / 3).toBe(3)
    expect(first.manifest.products).toBe(5)
    // @ts-expect-error Node only.
    const { createHash } = await import('node:crypto')
    for (const [name] of first.manifest.packs as Array<[string, number]>) expect(name).toBe(`${name.slice(0, -16)}${createHash('sha256').update(first.files[name]).digest('hex').slice(0, 12)}.bin`)
  })

  it('splits packs at the size limit and never exceeds it', async () => {
    const { products, stats } = await load(FOODS)
    const output = f('buildOutput')(products, stats, { ...small, maxPackBytes: 400 })
    expect(output.manifest.packs.length).toBeGreaterThan(1)
    for (const [, size] of output.manifest.packs as Array<[string, number]>) expect(size).toBeLessThanOrEqual(400)
    const m = output.manifest
    const places = [...m.detail.places, ...m.summaries.places, ...m.pop.places, ...m.posts.places, ...m.heads.places]
    for (let index = 0; index < places.length; index += 3) expect(places[index + 1] + places[index + 2]).toBeLessThanOrEqual(m.packs[places[index]][1])
  })

  it('summaries cap long serving text', () => {
    expect((f('summaryServing')({ household: 'x'.repeat(50), size: 10, unit: 'g' }) as string).length).toBeLessThanOrEqual(28)
  })
})

describe('search index (review: every word is indexed, common words have heads)', () => {
  const many: SyntheticFood[] = []
  const flavours = ['Vanilla', 'Chocolate', 'Strawberry', 'Mango', 'Peach', 'Lemon']
  flavours.forEach((flavour, at) => {
    many.push({ fdc: 200 + at, gtin: `0123450000${at}${[0, 5, 0, 5, 2, 7][at]}`, brand: 'CHOBANI', name: `GREEK YOGURT ${flavour.toUpperCase()}`, nutrients: macros(10, 2, 6) })
  })
  many.push({ fdc: 300, gtin: '0987650000010', brand: 'JIF', name: 'PEANUT BUTTER CREAMY', nutrients: macros(25, 50, 20) })
  many.push({ fdc: 301, gtin: '0987650000027', brand: 'SKIPPY', name: 'PEANUT BUTTER CHUNKY', nutrients: macros(25, 50, 20) })
  many.push({ fdc: 302, gtin: '0987650000034', brand: 'GREAT VALUE', name: 'PEANUT BUTTER CREAMY', nutrients: macros(25, 50, 20) })

  it('postings hold every token of every product, in ascending ordinals', async () => {
    const { products, stats } = await load(many)
    const out = f('buildOutput')(products, stats, { blockRows: 4, headMin: 2, headRows: 3 })
    const ordered = out.ordered as Array<{ name: string; brand: string; ordinal: number }>
    const postings = f('buildPostings')(ordered) as Map<string, number[]>
    for (const product of ordered) {
      for (const token of f('indexTokensOf')(product.name, product.brand)) expect(postings.get(token), token).toContain(product.ordinal)
    }
    for (const list of postings.values()) expect([...list].sort((a, b) => a - b)).toEqual(list)
    // The most common word reaches all its products (the first build kept only the 6 rarest words per product).
    expect(postings.get('yogurt')?.length).toBe(6)
    expect(postings.get('butter')?.length).toBe(3)
    expect(postings.get('greek')?.length).toBe(6)
    // GTIN order: ordinal i is the i-th smallest GTIN.
    expect(ordered.map((product) => product.ordinal)).toEqual(ordered.map((_product, index) => index))
  })

  it('varint postings round-trip', () => {
    const list = [0, 1, 5, 300, 70000, 16_000_000]
    const bytes = f('encodePostingList')(list) as number[]
    const decoded: number[] = []
    let value = 0
    let scale = 1
    let running = 0
    for (const byte of bytes) {
      value += (byte & 127) * scale
      if (byte & 128) { scale *= 128; continue }
      running += value
      decoded.push(running)
      value = 0
      scale = 1
    }
    expect(decoded).toEqual(list)
  })

  it('pop: one byte per ordinal in GTIN order, in a shard of its own', async () => {
    const { products, stats } = await load(many)
    const out = f('buildOutput')(products, stats, { blockRows: 4, headMin: 2, headRows: 3 })
    expect(out.manifest.pop.places).toHaveLength(3)
    const [pack, offset, length] = out.manifest.pop.places as number[]
    const bytes = gunzipSync((out.files[out.manifest.packs[pack][0]] as Uint8Array).subarray(offset, offset + length))
    expect(bytes.length).toBe(products.length)
    expect([...bytes]).toEqual(out.ordered.map((product: { popQ: number }) => Math.min(7, Math.floor(product.popQ / 4))))
  })

  it('posts: a token with long postings has a shard of its own, so one Range reads it', () => {
    const postings = new Map<string, number[]>([['aaa', [1, 2]], ['bbb', [3]], ['common', Array.from({ length: 5000 }, (_unused, index) => index * 3)], ['zzz', [4]]])
    const shards = f('buildPostsShards')(postings, 100000, 200) as Array<{ first: string; tokens: number }>
    expect(shards.map((shard) => [shard.first, shard.tokens])).toEqual([['aaa', 2], ['common', 1], ['zzz', 1]])
  })

  it('heads: tokens with more than headMin products get their best products, one per brand + name, best first', async () => {
    const { products, stats } = await load(many)
    const out = f('buildOutput')(products, stats, { blockRows: 4, headMin: 2, headRows: 3, pairMin: 1, pairRows: 3 })
    const common = new Map<string, number>((out.manifest.common as string).split(' ').map((entry) => { const at = entry.lastIndexOf(':'); return [entry.slice(0, at), parseInt(entry.slice(at + 1), 36)] }))
    expect(common.get('yogurt')).toBe(6)
    expect(common.get('butter')).toBe(3)
    expect(common.has('jif')).toBe(false) // one product only
    expect(common.has('peanut+butter')).toBe(true) // a very common adjacent pair has a head of its own (a ranking aid)
    expect(out.manifest.brandTokens).toContain('chobani')
    expect(out.manifest.brandDominant).not.toContain('yogurt')
  })
})
