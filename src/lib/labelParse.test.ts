import { describe, expect, it } from 'vitest'
import { parseLabel, type LabelKey } from './labelParse'

const v = (text: string, key: LabelKey) => parseLabel(text).values[key]

const CLEAN = `Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 160mg 7%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Protein 3g
Vitamin D 2mcg 10%
Calcium 260mg 20%
Iron 8mg 45%
Potassium 235mg 5%
* The % Daily Value (DV) tells you how much a nutrient contributes. 2,000 calories a day is used for general nutrition advice.`

describe('parseLabel: clean US label', () => {
  const parsed = parseLabel(CLEAN)
  it('reads serving, servings per container and every field', () => {
    expect(parsed.basis).toBe('per serving')
    expect(parsed.servingText).toBe('2/3 cup (55g)')
    expect(parsed.servingAmount).toEqual({ value: 55, unit: 'g' })
    expect(parsed.servingsPerContainer).toBe(8)
    const got = Object.fromEntries(Object.entries(parsed.values).map(([k, x]) => [k, x.value]))
    expect(got).toEqual({ calories: 230, fat: 8, satFat: 1, transFat: 0, cholesterol: 0, sodium: 160, carbs: 37, fiber: 4, sugars: 12, addedSugars: 10, protein: 3, vitaminD: 2, calcium: 260, iron: 8, potassium: 235 })
    expect(Object.values(parsed.values).filter((x) => x.confidence === 'check')).toEqual([])
    expect(parsed.checkNumbers).toBe(false)
    expect(parsed.hasCalories).toBe(true)
  })
})

describe('parseLabel: OCR noise on numbers', () => {
  it('reads "Og" and "O g" as zero', () => {
    expect(v('Calories 100\nTotal Fat Og 0%\nTrans Fat O g\nProtein 5g', 'fat')?.value).toBe(0)
    expect(v('Calories 100\nTrans Fat O g', 'transFat')?.value).toBe(0)
    expect(v('Calories 100\nCholesterol Omg 0%', 'cholesterol')?.value).toBe(0)
  })
  it('reads lower case omg and glued labels', () => {
    expect(v('Cholesterol omg 0%\nTransFatog', 'cholesterol')?.value).toBe(0)
    expect(v('~TransFatog', 'transFat')?.value).toBe(0)
  })
  it('prefers the value consistent with the %DV when g is read as 9', () => {
    expect(v('Total Fat 129 16%', 'fat')?.value).toBe(12)
    expect(v('Total Carbohydrate 159 5%', 'carbs')?.value).toBe(15)
    expect(v('Dietary Fiber 19 4%', 'fiber')?.value).toBe(1)
    expect(v('Saturated Fat 1.59 8%', 'satFat')?.value).toBe(1.5)
  })
  it('keeps the full number when the %DV says so', () => {
    expect(v('Protein 99\nTotal Fat 39 50%', 'fat')?.value).toBe(39)
  })
  it('flags a trailing 9 with no %DV as check, using the stripped reading first', () => {
    const protein = v('Protein 29', 'protein')
    expect(protein).toMatchObject({ value: 2, confidence: 'check' })
    expect(protein?.alternatives).toContain(29)
  })
  it('uses the per container column to settle a trailing 9', () => {
    const parsed = parseLabel('Nutrition Facts\nAbout 6 servings per container\nPer Per\nserving container\nCalories 160 960\nProtein 29 12g')
    expect(parsed.values.protein).toMatchObject({ value: 2, confidence: 'ok' })
  })
  it('reads l and I as 1', () => {
    expect(v('Calories l20', 'calories')).toMatchObject({ value: 120, confidence: 'check' })
    expect(v('Sodium I70mg 7%', 'sodium')).toMatchObject({ value: 170, confidence: 'ok' })
  })
  it('handles missing spaces', () => {
    const parsed = parseLabel('Calories230\nTotalFat8g10%\nSaturatedFat1g5%\nSodium160mg7%\nTotalCarbohydrate37g13%\nProtein3g')
    expect(parsed.values.calories?.value).toBe(230)
    expect(parsed.values.fat?.value).toBe(8)
    expect(parsed.values.satFat?.value).toBe(1)
    expect(parsed.values.sodium?.value).toBe(160)
    expect(parsed.values.carbs?.value).toBe(37)
  })
  it('reads decimal commas and thousands marks', () => {
    expect(v('Saturated Fat 1,5 g 8%', 'satFat')?.value).toBe(1.5)
    expect(v('Sodium 1,200mg 52%', 'sodium')?.value).toBe(1200)
  })
  it('uses 0.5 and flags <1g in any garbling', () => {
    expect(v('Total Sugars <1g', 'sugars')).toMatchObject({ value: 0.5, confidence: 'check' })
    expect(v('Total Sugars <lg', 'sugars')).toMatchObject({ value: 0.5, confidence: 'check' })
    expect(v('Dietary Fiber less than 1g', 'fiber')).toMatchObject({ value: 0.5, confidence: 'check' })
  })
  it('corrects sodium printed in grams or with a lost m', () => {
    expect(v('Sodium 0.17 g', 'sodium')?.value).toBe(170)
    expect(v('Sodium 170 g 7%', 'sodium')?.value).toBe(170)
    expect(v('Sodium 170m9 7%', 'sodium')?.value).toBe(170)
  })
  it('flags a value that disagrees with its %DV', () => {
    expect(v('Sodium 600mg 7%', 'sodium')).toMatchObject({ value: 600, confidence: 'check' })
  })
  it('derives a value from the %DV alone and flags it', () => {
    // Never derived from the percentage: the box stays blank and the row is listed as unread.
    const parsed = parseLabel('Total Fat 10%')
    expect(parsed.values.fat).toBeUndefined()
    expect(parsed.unread.fat).toMatch(/Daily Value/)
  })
  it('takes amounts from the neighbouring line when columns were split', () => {
    const parsed = parseLabel('Calories 160 960\n170mg 1020mg\nSodium 7% 44%\nTotal\nCarbohydrate 15g 5% 90g 33%')
    expect(parsed.values.sodium?.value).toBe(170)
    expect(parsed.values.carbs?.value).toBe(15)
    // Two columns whose headers were not read: every value is flagged, none is silently taken.
    expect(parsed.values.sodium?.confidence).toBe('check')
  })
})

describe('parseLabel: layouts and wording', () => {
  it('ignores Calories from fat', () => {
    expect(parseLabel('Calories 250 Calories from Fat 110\nTotal Fat 12g 18%').values.calories?.value).toBe(250)
    const parsed = parseLabel('Calories from Fat 110\nCalories 250')
    expect(parsed.values.calories?.value).toBe(250)
    expect(parsed.values.fat).toBeUndefined()
  })
  it('takes per serving from a dual column label and says so', () => {
    const parsed = parseLabel('Nutrition Facts\nAbout 6 servings per container\nServing size 1 oz (28g)\nPer serving Per container\nCalories 160 960\nTotal Fat 10g 13% 60g 77%\nSodium 170mg 7% 1020mg 44%')
    expect(parsed.values.calories?.value).toBe(160)
    expect(parsed.values.fat?.value).toBe(10)
    expect(parsed.values.sodium?.value).toBe(170)
    expect(parsed.notes.join(' ')).toMatch(/per serving/i)
  })
  it('stops at the footer and ignores Less than lines', () => {
    const parsed = parseLabel('Calories 100\nProtein 3g\n* Percent Daily Values are based on a 2,000 calorie diet.\nTotal Fat Less than 65g 80g\nCalories: 2,000 2,500\nSodium Less than 2,400mg')
    expect(parsed.values.fat).toBeUndefined()
    expect(parsed.values.sodium).toBeUndefined()
    expect(parsed.values.calories?.value).toBe(100)
  })
  it('ignores poly and monounsaturated lines', () => {
    const parsed = parseLabel('Total Fat 8g 10%\nSaturated Fat 1g 5%\nPolyunsaturated Fat 2g\nMonounsaturated Fat 4g')
    expect(parsed.values.fat?.value).toBe(8)
    expect(parsed.values.satFat?.value).toBe(1)
  })
  it('reads a bilingual English and French label', () => {
    const parsed = parseLabel('Nutrition Facts / Valeur nutritive\nPer 1 cup (250 mL)\nCalories / Calories 110\nLipides / Fat 2 g 3 %\nSaturated / saturés 0.5 g 3 %\nGlucides / Carbohydrate 20 g 7 %\nFibres / Fibre 3 g 11 %\nSucres / Sugars 4 g\nProtéines / Protein 4 g\nSodium / Sodium 140 mg 6 %')
    expect(parsed.values).toMatchObject({ calories: { value: 110 }, fat: { value: 2 }, satFat: { value: 0.5 }, carbs: { value: 20 }, fiber: { value: 3 }, sugars: { value: 4 }, protein: { value: 4 }, sodium: { value: 140 } })
  })
  it('reads a Spanish label', () => {
    const parsed = parseLabel('Información nutricional\nTamaño por porción 1 taza (240 mL)\nCalorías 150\nGrasa total 8 g 10%\nGrasa saturada 4.5 g 23%\nColesterol 35 mg 12%\nSodio 125 mg 5%\nCarbohidratos totales 12 g 4%\nAzúcares totales 12 g\nProteína 8 g')
    expect(parsed.servingAmount).toEqual({ value: 240, unit: 'ml' })
    expect(parsed.values).toMatchObject({ calories: { value: 150 }, fat: { value: 8 }, satFat: { value: 4.5 }, cholesterol: { value: 35 }, sodium: { value: 125 }, carbs: { value: 12 }, sugars: { value: 12 }, protein: { value: 8 } })
  })
  it('reads Includes Added Sugars with the amount in front', () => {
    expect(v('Total Sugars 22g\nIncludes 18g Added Sugars 36%', 'addedSugars')).toMatchObject({ value: 18, confidence: 'ok' })
    expect(v('Total Sugars 22g\nIncludes 18g Added Sugars 36%', 'sugars')?.value).toBe(22)
  })
  it('reads the serving size when the words are split over lines', () => {
    const parsed = parseLabel('About 6 servings per container\nServing\nsize 1 oz (28g/about 15\nCalories 160')
    expect(parsed.servingAmount?.value).toBe(28)
    expect(parsed.servingsPerContainer).toBe(6)
  })
  it('cleans "(559)" in the serving size to (55g)', () => {
    const parsed = parseLabel('Serving size 2/3 cup (559)\nCalories 230')
    expect(parsed.servingText).toBe('2/3 cup (55g)')
    expect(parsed.servingAmount).toEqual({ value: 55, unit: 'g' })
  })
  it('reads about N servings per container with fractions', () => {
    expect(parseLabel('Servings per container: about 3.5\nCalories 100').servingsPerContainer).toBe(3.5)
  })
})

describe('parseLabel: per 100 g tables', () => {
  const EU = 'Nutrition information\nTypical values per 100 g\nEnergy 1046 k) / 250 kcal\nFat 12g\nof which saturates 32g\nCarbohydrate 30g\nof which sugars 54g\nFibre 2.5g\nProtein 6.19\nSalt 1.2g'
  it('detects the basis and converts salt to sodium', () => {
    const parsed = parseLabel(EU)
    expect(parsed.basis).toBe('per 100 g')
    expect(parsed.servingAmount).toEqual({ value: 100, unit: 'g' })
    expect(parsed.values.calories?.value).toBe(250)
    expect(parsed.values.fat?.value).toBe(12)
    expect(parsed.values.fiber?.value).toBe(2.5)
    expect(parsed.values.sodium?.value).toBe(480)
  })
  it('restores a lost decimal point using the parent nutrient', () => {
    const parsed = parseLabel(EU)
    expect(parsed.values.satFat).toMatchObject({ value: 3.2, confidence: 'check' })
    expect(parsed.values.sugars).toMatchObject({ value: 5.4, confidence: 'check' })
    expect(parsed.values.protein?.value).toBe(6.1)
  })
  it('converts kJ when kcal is missing and detects per 100 ml', () => {
    const parsed = parseLabel('Nutrition per 100 ml\nEnergy 418 kJ\nFat 0.5 g\nCarbohydrate 10 g\nProtein 1 g')
    expect(parsed.basis).toBe('per 100 ml')
    expect(parsed.values.calories?.value).toBe(100)
    expect(parsed.values.calories?.confidence).toBe('check')
  })
})

describe('parseLabel: sanity check', () => {
  it('flags numbers whose energy does not add up', () => {
    const parsed = parseLabel('Calories 100\nTotal Fat 20g\nTotal Carbohydrate 30g\nProtein 10g')
    expect(parsed.checkNumbers).toBe(true)
    expect(parsed.values.calories?.confidence).toBe('check')
    expect(parsed.values.fat?.confidence).toBe('check')
  })
  it('accepts numbers within about 25 percent', () => {
    const parsed = parseLabel('Calories 230\nTotal Fat 8g\nTotal Carbohydrate 37g\nProtein 3g')
    expect(parsed.checkNumbers).toBe(false)
  })
  it('re-reads a flagged number when exactly one other reading balances the energy', () => {
    // Protein "29" could be 2 or 29; only 2 fits 4P + 4C + 9F against 230 calories.
    const parsed = parseLabel('Calories 230\nTotal Fat 8g 10%\nTotal Carbohydrate 37g 13%\nProtein 29')
    expect(parsed.checkNumbers).toBe(false)
    expect(parsed.values.protein?.value).toBe(2)
  })
})

describe('parseLabel: nothing readable', () => {
  it('has no calories for junk or empty text', () => {
    expect(parseLabel('').hasCalories).toBe(false)
    expect(parseLabel('asdf qwer\n12 34 56').hasCalories).toBe(false)
    expect(parseLabel('Ingredients: sugar, flour, salt').hasCalories).toBe(false)
  })
})

describe('parseLabel: never silently wrong', () => {
  const US = (extra = '') => `Nutrition Facts\nServing size 1 cup (30g)\nCalories 110\nTotal Fat 2g 3%\nTotal Carbohydrate 22g 8%\nProtein 3g\n${extra}`
  it('flags calories when a macro is unread and lists it as unread', () => {
    const parsed = parseLabel('Nutrition Facts\nCalories 110\nTotal Fat 2g 3%\nTotal Carbohydrate 22g 8%')
    expect(parsed.values.calories?.confidence).toBe('check')
    expect(parsed.values.protein).toBeUndefined()
  })
  it('flags both when one macro alone exceeds the calories', () => {
    const parsed = parseLabel('Nutrition Facts\nCalories 100\nTotal Fat 20g 26%\nTotal Carbohydrate 5g 2%\nProtein 3g')
    expect(parsed.values.calories?.confidence).toBe('check')
    expect(parsed.values.fat?.confidence).toBe('check')
  })
  it('flags near-zero calories next to real macros', () => {
    const parsed = parseLabel('Nutrition Facts\nCalories 2\nTotal Fat 6g 8%\nTotal Carbohydrate 22g 8%\nProtein 3g')
    expect(parsed.values.calories?.confidence).toBe('check')
  })
  it('reads "<1g" garbled as "<lg" as half a gram, not a dropped cell', () => {
    expect(v('Total Sugars <lg', 'sugars')).toMatchObject({ value: 0.5, confidence: 'check' })
  })
  it('resolves "(599g)" to the shorter weight and flags it', () => {
    const parsed = parseLabel(US().replace('(30g)', '(599g)'))
    expect(parsed.servingAmount?.value).toBe(59)
    expect(parsed.servingCheck).toBeTruthy()
  })
  it('does not take total fat from the tail of a garbled Saturated Fat', () => {
    expect(parseLabel('Calories 250\noe rated Fat 30').values.fat).toBeUndefined()
  })
  it('flags a lone number in a two column table instead of taking it', () => {
    const parsed = parseLabel('Nutrition Facts\nPer Per\nServing Container\nCalories 160 960\nSaturated Fat 99 45%')
    expect(parsed.values.satFat?.confidence).toBe('check')
  })
  it('flags a row with two numbers when the headers were not read', () => {
    expect(v('Calories 110\nTotal Fat 4 5g (6% DV)', 'fat')?.confidence).toBe('check')
  })
  it('stops reading nutrients at the ingredients', () => {
    const parsed = parseLabel(US('INGREDIENTS: oats, sugar. Protein 90g'))
    expect(parsed.values.protein?.value).toBe(3)
  })
  it('does not treat sugar alcohols as sugars', () => {
    expect(parseLabel(US('Sugar Alcohol 4g')).values.sugars).toBeUndefined()
  })
  it('does not mistake "servings per container" for a second column header', () => {
    const parsed = parseLabel(US('About 8 servings per container'))
    expect(parsed.notes.join(' ')).not.toMatch(/per container/i)
  })
  it('uses the old daily values when Calories from Fat is printed', () => {
    expect(v('Calories 250 Calories from Fat 110\nTotal Fat 12g 18%', 'fat')).toMatchObject({ value: 12, confidence: 'ok' })
  })
})
