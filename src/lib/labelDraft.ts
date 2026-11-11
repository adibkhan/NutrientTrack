import type { LabelKey, ParsedLabel } from './labelParse'
import { inputText } from './decimal'
import { emptyNutrientDraft, nutrientDraftFrom, type NutrientDraft, type NutrientKey } from './nutrients'
import { scaleBase, type ServingBase } from './servings'

/** One thing to check against the package. `field` is the form box it belongs to (same id as the box: calories, protein, sodium, serving, grams...); without one it can only be confirmed. */
export interface LabelCheck { id: string; name: string; read: string; why: string; field: boolean }

/** What a scanned label fills into the manual entry form. One serving's worth, with servings set to 1. */
export interface LabelFill {
  /** Form strings, ready to merge into the entry draft. */
  fields: { calories: string; protein: string; carbs: string; fat: string; grams: string; serving: string; servings: string; nutrients: NutrientDraft }
  /** One serving's numbers, so the servings control can multiply them. Absent for per 100 g labels: there the person types the grams they ate. */
  base?: ServingBase
  /** Per 100 g or 100 ml labels: the label's figures, scaled by the grams eaten. */
  per100?: { unit: 'g' | 'ml'; base: ServingBase }
  /** Things the reader was unsure of. Each must be edited or confirmed before saving. */
  checks: LabelCheck[]
  /** Core boxes (calories, protein, carbs, fat) whose number could not be read. They stay blank and block saving. */
  blanks: string[]
  /** Plain-language lines for the review note. */
  notes: string[]
  servingsPerContainer?: number
  basis: ParsedLabel['basis']
}

/** Label values the app stores, and the box each one fills. */
const NUTRIENT_FOR: Partial<Record<LabelKey, NutrientKey>> = { fiber: 'fiber', sodium: 'sodium', sugars: 'sugar', satFat: 'satFat', cholesterol: 'cholesterol', transFat: 'transFat', vitaminD: 'vitaminD', calcium: 'calcium', iron: 'iron', potassium: 'potassium' }
const BASIC_KEYS: NutrientKey[] = ['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol']
const LABELS: Record<LabelKey, string> = {
  calories: 'Calories', fat: 'Total fat', satFat: 'Saturated fat', transFat: 'Trans fat', cholesterol: 'Cholesterol', sodium: 'Sodium', carbs: 'Total carbohydrate', fiber: 'Dietary fiber',
  sugars: 'Total sugars', addedSugars: 'Added sugars', protein: 'Protein', vitaminD: 'Vitamin D', calcium: 'Calcium', iron: 'Iron', potassium: 'Potassium',
}
export const labelName = (key: LabelKey): string => LABELS[key]
export const labelUnit = (key: LabelKey): string => (key === 'calories' ? 'kcal' : key === 'cholesterol' || key === 'sodium' || key === 'calcium' || key === 'iron' || key === 'potassium' ? 'mg' : key === 'vitaminD' ? 'mcg' : 'g')

export const labelToFill = (parsed: ParsedLabel): LabelFill => {
  const get = (key: LabelKey): number | undefined => parsed.values[key]?.value
  const nutrients = emptyNutrientDraft()
  const baseNutrients: ServingBase['nutrients'] = {}
  const checks: LabelCheck[] = []
  const blanks: string[] = []
  for (const key of Object.keys(parsed.values) as LabelKey[]) {
    const entry = parsed.values[key]
    if (!entry) continue
    const boxName = key === 'calories' || key === 'protein' || key === 'carbs' || key === 'fat' ? key : NUTRIENT_FOR[key]
    if (!boxName) continue
    if (entry.confidence === 'check') checks.push({ id: boxName, name: labelName(key), read: `${inputText(entry.value)} ${labelUnit(key)}`, why: entry.note ?? 'Hard to read.', field: true })
    if (boxName in nutrients) {
      nutrients[boxName as NutrientKey] = inputText(entry.value)
      baseNutrients[boxName as NutrientKey] = entry.value
    }
  }
  // A row that was on the label but unreadable stays blank; calories also needs a check so it cannot be skipped.
  for (const key of Object.keys(parsed.unread) as LabelKey[]) {
    const boxName = key === 'calories' || key === 'protein' || key === 'carbs' || key === 'fat' ? key : NUTRIENT_FOR[key]
    if (!boxName || get(key) !== undefined) continue
    if (boxName === 'calories') checks.push({ id: 'calories', name: 'Calories', read: 'not read', why: parsed.unread[key] ?? 'The number could not be read.', field: true })
    else if (boxName === 'fiber' || boxName === 'sodium' || boxName === 'sugar' || boxName === 'satFat' || boxName === 'cholesterol') checks.push({ id: boxName, name: labelName(key), read: 'not read', why: parsed.unread[key] ?? 'The number could not be read.', field: true })
  }
  if (get('calories') === undefined && !checks.some((check) => check.id === 'calories')) checks.push({ id: 'calories', name: 'Calories', read: 'not read', why: 'The calories could not be read. Type them from the package.', field: true })
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) if (get(key) === undefined) blanks.push(key)
  const grams = parsed.servingAmount?.unit === 'g' ? parsed.servingAmount.value : undefined
  const per100 = parsed.basis !== 'per serving'
  const unit = parsed.basis === 'per 100 ml' ? 'ml' : 'g'
  if (parsed.servingCheck) {
    checks.push({ id: 'serving', name: 'Serving size', read: parsed.servingText ?? 'not read', why: parsed.servingCheck, field: true })
    if (grams !== undefined) checks.push({ id: 'grams', name: 'Serving weight', read: `${inputText(grams)} g`, why: parsed.servingCheck, field: false })
  }
  if (parsed.basisCheck) checks.push({ id: 'basis', name: 'What the numbers are for', read: parsed.basis, why: parsed.basisCheck, field: false })
  if (parsed.servingsCheck) checks.push({ id: 'servings-per-container', name: 'Servings per container', read: parsed.servingsPerContainer === undefined ? 'not read' : inputText(parsed.servingsPerContainer), why: parsed.servingsCheck, field: false })
  const base: ServingBase = { calories: get('calories') ?? 0, protein: get('protein') ?? 0, carbs: get('carbs') ?? 0, fat: get('fat') ?? 0, nutrients: baseNutrients, ...(grams && !per100 && !checks.some((check) => check.id === 'grams') ? { grams } : {}) }
  const text = (key: LabelKey): string => (get(key) === undefined ? '' : inputText(get(key) as number))
  const notes = [...parsed.notes]
  const unsaved = (['addedSugars'] as LabelKey[]).filter((key) => get(key) !== undefined)
  if (unsaved.length > 0) notes.push(`Also on the label, kept here as a note (the app has no box for it): ${unsaved.map((key) => `${labelName(key).toLowerCase()} ${inputText(get(key) as number)} ${labelUnit(key)}`).join(', ')}.`)
  for (const key of Object.keys(parsed.unread) as LabelKey[]) {
    const boxName = NUTRIENT_FOR[key]
    if (boxName && !BASIC_KEYS.includes(boxName) && get(key) === undefined) notes.push(`${labelName(key)} could not be read; its box is left empty (not recorded).`)
  }
  const servingGrams = grams !== undefined && !checks.some((check) => check.id === 'grams') ? inputText(grams) : ''
  return {
    fields: {
      // Per 100 g labels fill the boxes only once the grams eaten are typed.
      calories: per100 ? '' : text('calories'), protein: per100 ? '' : text('protein'), carbs: per100 ? '' : text('carbs'), fat: per100 ? '' : text('fat'),
      grams: per100 ? '' : servingGrams,
      serving: per100 ? '' : parsed.servingText && parsed.basis === 'per serving' ? parsed.servingText : '1 serving',
      servings: per100 ? '' : '1',
      nutrients: per100 ? emptyNutrientDraft() : nutrients,
    },
    ...(per100 ? { per100: { unit, base } } : { base }),
    checks,
    blanks,
    notes,
    servingsPerContainer: parsed.servingsPerContainer,
    basis: parsed.basis,
  }
}

/** The figures for `eaten` grams (or ml) of a per 100 label, as form strings. Blank when the amount is not a positive number. Boxes the label did not give keep what the person typed. */
export const per100Fields = (fill: LabelFill, eaten: string, current: Record<'calories' | 'protein' | 'carbs' | 'fat', string>): Pick<LabelFill['fields'], 'calories' | 'protein' | 'carbs' | 'fat' | 'grams' | 'serving' | 'servings' | 'nutrients'> => {
  const amount = Number(eaten.replace(',', '.'))
  const none = { calories: '', protein: '', carbs: '', fat: '', grams: '', serving: '', servings: '', nutrients: emptyNutrientDraft() }
  if (!fill.per100) return none
  const typed = (id: 'calories' | 'protein' | 'carbs' | 'fat') => (fill.blanks.includes(id) ? current[id] : '')
  if (!eaten.trim() || !Number.isFinite(amount) || amount <= 0) return { ...none, calories: typed('calories'), protein: typed('protein'), carbs: typed('carbs'), fat: typed('fat') }
  const scaled = scaleBase(fill.per100.base, amount / 100)
  const round = (value: number) => inputText(Math.round(value * 10) / 10)
  const read = (id: 'calories' | 'protein' | 'carbs' | 'fat') => (fill.blanks.includes(id) ? current[id] : round(scaled[id]))
  return {
    calories: read('calories'), protein: read('protein'), carbs: read('carbs'), fat: read('fat'),
    grams: fill.per100.unit === 'g' ? inputText(amount) : '', serving: `${inputText(amount)} ${fill.per100.unit}`, servings: '',
    nutrients: nutrientDraftFrom(scaled.nutrients),
  }
}
