import type { DiaryEntry } from '../types'

/** Extra nutrients a food or entry can carry. Each is optional: missing means "not recorded", never zero. */
export const NUTRIENTS = [
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'sugar', label: 'Sugar', unit: 'g' },
  { key: 'satFat', label: 'Saturated fat', unit: 'g' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
] as const

export type NutrientKey = (typeof NUTRIENTS)[number]['key']
export type NutrientValues = Partial<Record<NutrientKey, number>>
export type NutrientDraft = Record<NutrientKey, string>

export const NUTRIENT_KEYS: NutrientKey[] = NUTRIENTS.map((nutrient) => nutrient.key)

export const emptyNutrientDraft = (): NutrientDraft => ({ fiber: '', sodium: '', sugar: '', satFat: '', cholesterol: '' })

/** Form strings from a stored record; a missing value is an empty box, not "0". */
export const nutrientDraftFrom = (record: NutrientValues | undefined): NutrientDraft => {
  const draft = emptyNutrientDraft()
  for (const key of NUTRIENT_KEYS) {
    const value = record?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) draft[key] = String(value)
  }
  return draft
}

/** The valid, non-empty values in a draft. Empty boxes are left out so they stay "not recorded". */
export const nutrientValuesFrom = (draft: NutrientDraft): NutrientValues => {
  const values: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) {
    const text = draft[key].trim()
    if (!text) continue
    const parsed = Number(text)
    if (Number.isFinite(parsed) && parsed >= 0) values[key] = parsed
  }
  return values
}

/** The first box that holds something that is not a number of zero or more, or undefined when all are fine. */
export const invalidNutrient = (draft: NutrientDraft): (typeof NUTRIENTS)[number] | undefined =>
  NUTRIENTS.find((nutrient) => {
    const text = draft[nutrient.key].trim()
    if (!text) return false
    const parsed = Number(text)
    return !Number.isFinite(parsed) || parsed < 0
  })

export interface NutrientTotal { total: number; foods: number }

/** Totals over eaten entries that recorded each nutrient, with how many foods that covers. Unrecorded nutrients are absent. */
export const sumNutrients = (entries: DiaryEntry[]): Partial<Record<NutrientKey, NutrientTotal>> => {
  const totals: Partial<Record<NutrientKey, NutrientTotal>> = {}
  for (const entry of entries) {
    if (entry.planned) continue
    for (const key of NUTRIENT_KEYS) {
      const value = entry[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const current = totals[key] ?? { total: 0, foods: 0 }
      totals[key] = { total: current.total + value, foods: current.foods + 1 }
    }
  }
  return totals
}
