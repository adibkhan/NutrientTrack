import { describe, expect, it } from 'vitest'
import { labelToFill, per100Fields } from './labelDraft'
import { parseLabel } from './labelParse'

const nonEmpty = (draft: Record<string, string>) => Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ''))

describe('labelToFill', () => {
  it('maps a per serving label onto the form with servings 1', () => {
    const fill = labelToFill(parseLabel('Nutrition Facts\nServing size 2/3 cup (55g)\nCalories 230\nTotal Fat 8g 10%\nSaturated Fat 1g 5%\nCholesterol 0mg 0%\nSodium 160mg 7%\nTotal Carbohydrate 37g 13%\nDietary Fiber 4g 14%\nTotal Sugars 12g\nIncludes 10g Added Sugars 20%\nProtein 3g\nIron 8mg 45%'))
    expect(fill.fields).toMatchObject({ calories: '230', protein: '3', carbs: '37', fat: '8', grams: '55', serving: '2/3 cup (55g)', servings: '1' })
    expect(nonEmpty(fill.fields.nutrients)).toEqual({ fiber: '4', sodium: '160', sugar: '12', satFat: '1', cholesterol: '0', iron: '8' })
    expect(fill.base).toMatchObject({ calories: 230, protein: 3, grams: 55 })
    expect(fill.checks).toEqual([])
    expect(fill.notes.join(' ')).toContain('added sugars 10 g')
    expect(fill.notes.join(' ')).not.toContain('iron')
  })
  it('fills trans fat, vitamin D, calcium, iron and potassium into their own boxes and keeps added sugars as a note', () => {
    const fill = labelToFill(parseLabel('Nutrition Facts\nServing size 1 cup (240g)\nCalories 120\nTotal Fat 4g 5%\nTrans Fat 0.5g\nTotal Carbohydrate 15g 5%\nIncludes 4g Added Sugars 8%\nProtein 8g\nVitamin D 2.5mcg 10%\nCalcium 300mg 25%\nIron 1mg 6%\nPotassium 400mg 8%'))
    expect(nonEmpty(fill.fields.nutrients)).toMatchObject({ transFat: '0.5', vitaminD: '2.5', calcium: '300', iron: '1', potassium: '400' })
    expect(fill.base?.nutrients).toMatchObject({ transFat: 0.5, vitaminD: 2.5, calcium: 300, iron: 1, potassium: 400 })
    expect(fill.notes.join(' ')).toContain('added sugars 4 g')
  })
  it('leaves a missing nutrient blank rather than zero', () => {
    const fill = labelToFill(parseLabel('Calories 100\nProtein 2g'))
    expect(fill.fields.nutrients.sodium).toBe('')
    expect(fill.fields.carbs).toBe('')
    expect(fill.fields.serving).toBe('1 serving')
  })
  it('lists each flagged box with the value the photo read', () => {
    const fill = labelToFill(parseLabel('Calories 100\nTotal Fat 20g\nTotal Carbohydrate 30g\nProtein 10g\nSodium 600mg 7%'))
    expect(fill.checks.map((check) => check.id).sort()).toEqual(['basis', 'calories', 'carbs', 'fat', 'protein', 'sodium'])
    expect(fill.checks.find((check) => check.id === 'sodium')).toMatchObject({ read: '600 mg', field: true })
  })
  it('keeps unread macros blank and lists them', () => {
    const fill = labelToFill(parseLabel('Nutrition Facts\nCalories 110\nTotal Fat 2g 3%\nTotal Carbohydrate 22g 8%'))
    expect(fill.fields.protein).toBe('')
    expect(fill.blanks).toContain('protein')
  })
  it('opens with calories blank and flagged when three nutrients were read but not the calories', () => {
    const parsed = parseLabel('Nutrition Facts\nTotal Fat 8g 10%\nTotal Carbohydrate 37g 13%\nProtein 3g')
    expect(parsed.usable).toBe(true)
    const fill = labelToFill(parsed)
    expect(fill.fields.calories).toBe('')
    expect(fill.checks.find((check) => check.id === 'calories')?.read).toBe('not read')
  })
  it('flags the serving weight and the basis like nutrients', () => {
    const fill = labelToFill(parseLabel('Nutrition Facts\nServing size 1 bar (599g)\nCalories 290\nTotal Fat 8g 10%\nTotal Carbohydrate 37g 13%\nProtein 3g'))
    expect(fill.checks.map((check) => check.id)).toContain('grams')
    expect(fill.fields.grams).toBe('')
  })
  it('asks for the grams eaten on a per 100 g label instead of filling the boxes', () => {
    const fill = labelToFill(parseLabel('Nutrition per 100 g\nEnergy 1046 kJ / 250 kcal\nFat 12 g\nCarbohydrate 30 g\nProtein 6 g'))
    expect(fill.base).toBeUndefined()
    expect(fill.fields.calories).toBe('')
    expect(per100Fields(fill, '', { calories: '', protein: '', carbs: '', fat: '' }).calories).toBe('')
    expect(per100Fields(fill, '150', { calories: '', protein: '', carbs: '', fat: '' })).toMatchObject({ calories: '375', fat: '18', grams: '150', serving: '150 g' })
  })
  it('names the basis for per 100 g labels', () => {
    const fill = labelToFill(parseLabel('Nutrition per 100 g\nEnergy 1046 kJ / 250 kcal\nFat 12 g\nCarbohydrate 30 g\nProtein 6 g'))
    expect(fill.basis).toBe('per 100 g')
    expect(fill.fields.serving).toBe('')
    expect(fill.per100?.unit).toBe('g')
  })
})
