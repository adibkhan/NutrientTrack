import type { DiaryEntry, MealCategory, WeightEntry } from '../types'
import { mealForHour } from './mascot'

/**
 * Importers for other trackers' CSV exports. Everything is parsed on the device; nothing is uploaded.
 * Columns are found by header name, never by position, because each app has added and reordered columns over time.
 *
 * Supported files:
 * - MyFitnessPal: Nutrition-Summary-*.csv (one row per meal per day) and Measurement-Summary-*.csv
 * - Cronometer: servings.csv (one row per food) and biometrics.csv
 * - Lose It!: food-logs.csv (one row per food) and weights.csv
 * - MacroFactor: the granular Food Log CSV (one row per food, no meal column)
 */
export type ImportSource = 'myfitnesspal' | 'cronometer' | 'loseit' | 'macrofactor'
export type ImportFormat = 'mfp-nutrition' | 'mfp-measurements' | 'cronometer-servings' | 'cronometer-biometrics' | 'loseit-food' | 'loseit-weights' | 'macrofactor-food'

export const SOURCE_LABELS: Record<ImportSource, string> = { myfitnesspal: 'MyFitnessPal', cronometer: 'Cronometer', loseit: 'Lose It!', macrofactor: 'MacroFactor' }
export const FORMAT_SOURCE: Record<ImportFormat, ImportSource> = {
  'mfp-nutrition': 'myfitnesspal', 'mfp-measurements': 'myfitnesspal', 'cronometer-servings': 'cronometer', 'cronometer-biometrics': 'cronometer',
  'loseit-food': 'loseit', 'loseit-weights': 'loseit', 'macrofactor-food': 'macrofactor',
}
/** Formats whose weight column carries no unit, so the person has to say which unit the other app used. */
export const NEEDS_WEIGHT_UNIT: ImportFormat[] = ['mfp-measurements', 'loseit-weights']

export type ImportedEntry = Omit<DiaryEntry, 'createdAt' | 'updatedAt'> & { importedFrom: ImportSource }
export type ImportedWeight = Omit<WeightEntry, 'createdAt' | 'updatedAt'> & { importedFrom: ImportSource }

export interface ParsedImport {
  format: ImportFormat
  entries: ImportedEntry[]
  weights: ImportedWeight[]
  /** Rows that could not be read (bad date, no calories) or were deleted in the other app. */
  skipped: number
}

/** RFC 4180 CSV with quotes, doubled quotes, CRLF and a leading byte-order mark. */
export const parseCsv = (input: string): string[][] => {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1 } else quoted = false
      } else field += character
    } else if (character === '"' && field === '') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  row.push(field)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  return rows
}

const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/\s+/g, ' ')

export const detectFormat = (headers: string[]): ImportFormat | undefined => {
  const has = (...names: string[]) => names.every((name) => headers.some((header) => normalizeHeader(header) === name))
  if (has('date', 'name', 'icon', 'calories', 'deleted')) return 'loseit-food'
  if (has('date', 'weight', 'deleted')) return 'loseit-weights'
  if (has('date', 'meal', 'calories') && headers.some((header) => normalizeHeader(header).startsWith('protein'))) return 'mfp-nutrition'
  if (has('day', 'food name', 'amount', 'energy (kcal)')) return 'cronometer-servings'
  if (has('day', 'metric', 'unit', 'amount')) return 'cronometer-biometrics'
  if (has('date', 'food name', 'calories (kcal)') && headers.some((header) => normalizeHeader(header).startsWith('serving weight'))) return 'macrofactor-food'
  if (has('date', 'weight') && !has('meal')) return 'mfp-measurements'
  return undefined
}

/** A number from a cell, or undefined for a blank or unreadable one. Thousands separators are removed. */
const numberFrom = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const cleaned = value.trim().replace(/,/g, '')
  if (!cleaned) return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}
const nonNegative = (value: number | undefined) => (value !== undefined && value >= 0 ? value : undefined)
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits

const pad = (value: number) => String(value).padStart(2, '0')
const validDate = (year: number, month: number, day: number): string | undefined => {
  if (!(year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return undefined
  const date = new Date(year, month - 1, day, 12)
  return date.getMonth() === month - 1 && date.getDate() === day ? `${year}-${pad(month)}-${pad(day)}` : undefined
}

/** ISO dates, and slash dates read as US month/day unless the first part can only be a day. */
export const dateFrom = (value: string | undefined): string | undefined => {
  const text = value?.trim() ?? ''
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(text)
  if (!match) return undefined
  let [first, second] = [Number(match[1]), Number(match[2])]
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
  if (first > 12 && second <= 12) [first, second] = [second, first]
  return validDate(year, first, second)
}

/** "8:30 AM", "08:30 PM" or "13:05" as "HH:MM"; undefined when blank or unreadable. */
export const timeFrom = (value: string | undefined): string | undefined => {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(value?.trim() ?? '')
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '')
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  return hour <= 23 && minute <= 59 ? `${pad(hour)}:${pad(minute)}` : undefined
}

export const mealFrom = (value: string | undefined, time?: string): MealCategory => {
  const text = value?.trim().toLowerCase() ?? ''
  if (text.startsWith('breakfast')) return 'breakfast'
  if (text.startsWith('lunch')) return 'lunch'
  if (text.startsWith('dinner') || text.startsWith('supper')) return 'dinner'
  if (text.startsWith('snack')) return 'snack'
  if (!text && time) return mealForHour(Number(time.slice(0, 2)))
  return 'other'
}

/** Stable ids, so importing the same file twice finds the first copy instead of making duplicates. */
const hash = (text: string) => {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(36)
}
const stableIds = () => {
  const seen = new Map<string, number>()
  return (prefix: string, key: string) => {
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return `import-${prefix}-${hash(key)}${count ? `-${count}` : ''}`
  }
}

type Row = Record<string, string>
const rowsAsObjects = (rows: string[][]): Row[] => {
  const headers = rows[0].map(normalizeHeader)
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}
/** First column whose name equals one of `names`, or starts with one ending in a space or "(" ("fiber" matches "fiber (g)"). */
const pick = (row: Row, ...names: string[]): string | undefined => {
  for (const name of names) {
    if (name in row) return row[name]
    const key = Object.keys(row).find((header) => header.startsWith(`${name} (`))
    if (key) return row[key]
  }
  return undefined
}
const optionalNutrients = (row: Row) => {
  const result: Partial<Pick<DiaryEntry, 'fiber' | 'sugar' | 'sodium' | 'satFat' | 'cholesterol'>> = {}
  const fiber = nonNegative(numberFrom(pick(row, 'fiber')))
  const sugar = nonNegative(numberFrom(pick(row, 'sugars', 'sugar')))
  const sodium = nonNegative(numberFrom(pick(row, 'sodium')))
  const satFat = nonNegative(numberFrom(pick(row, 'saturated fat', 'saturated')))
  const cholesterol = nonNegative(numberFrom(pick(row, 'cholesterol')))
  if (fiber !== undefined) result.fiber = round(fiber)
  if (sugar !== undefined) result.sugar = round(sugar)
  if (sodium !== undefined) result.sodium = round(sodium)
  if (satFat !== undefined) result.satFat = round(satFat)
  if (cholesterol !== undefined) result.cholesterol = round(cholesterol)
  return result
}

export const parseImport = (text: string, weightUnit: 'lb' | 'kg' = 'lb'): ParsedImport | undefined => {
  const table = parseCsv(text)
  if (table.length === 0) return undefined
  const format = detectFormat(table[0])
  if (!format) return undefined
  const source = FORMAT_SOURCE[format]
  const rows = rowsAsObjects(table)
  const idFor = stableIds()
  const entries: ImportedEntry[] = []
  const weights: ImportedWeight[] = []
  let skipped = 0

  const addEntry = (row: Row, date: string | undefined, meal: MealCategory, name: string, time?: string) => {
    const calories = nonNegative(numberFrom(pick(row, 'calories', 'energy')))
    if (!date || calories === undefined || !name.trim()) { skipped += 1; return }
    const macro = (...names: string[]) => round(nonNegative(numberFrom(pick(row, ...names))) ?? 0)
    entries.push({
      id: idFor(format, [date, time ?? '', meal, name.trim(), calories].join('|')),
      date,
      meal,
      name: name.trim().slice(0, 200),
      calories: round(calories, 1),
      protein: macro('protein'),
      carbs: macro('carbohydrates', 'carbs'),
      fat: macro('fat'),
      ...(time ? { time } : {}),
      ...optionalNutrients(row),
      importedFrom: source,
    })
  }
  const addWeight = (date: string | undefined, value: number | undefined, unit: 'lb' | 'kg', bodyFat?: number) => {
    if (!date || value === undefined || !(value > 0)) { skipped += 1; return }
    weights.push({
      id: idFor(format, `${date}|${value}|${unit}`),
      date,
      weight: round(value, 2),
      unit,
      ...(bodyFat !== undefined && bodyFat > 0 && bodyFat < 100 ? { bodyFat: round(bodyFat, 1) } : {}),
      importedFrom: source,
    })
  }

  for (const row of rows) {
    switch (format) {
      case 'mfp-nutrition': {
        const meal = row.meal?.trim() || 'Food'
        addEntry(row, dateFrom(row.date), mealFrom(meal), `MyFitnessPal ${meal.toLowerCase()}`)
        break
      }
      case 'mfp-measurements':
        addWeight(dateFrom(row.date), numberFrom(row.weight), weightUnit, numberFrom(pick(row, 'body fat %', 'body fat')))
        break
      case 'cronometer-servings': {
        const time = timeFrom(row.time)
        addEntry(row, dateFrom(row.day), mealFrom(row.group, time), row['food name'] ?? '', time)
        break
      }
      case 'cronometer-biometrics': {
        if (row.metric?.trim().toLowerCase() !== 'weight') break
        const unit = /kg/i.test(row.unit ?? '') ? 'kg' : /lb/i.test(row.unit ?? '') ? 'lb' : undefined
        if (!unit) { skipped += 1; break }
        addWeight(dateFrom(row.day), numberFrom(row.amount), unit)
        break
      }
      case 'loseit-food': {
        if (row.deleted?.trim().toLowerCase() === 'true') { skipped += 1; break }
        addEntry(row, dateFrom(row.date), mealFrom(row.type ?? row.meal), row.name ?? '')
        break
      }
      case 'loseit-weights':
        if (row.deleted?.trim().toLowerCase() === 'true') { skipped += 1; break }
        addWeight(dateFrom(row.date), numberFrom(row.weight), weightUnit)
        break
      case 'macrofactor-food': {
        const time = timeFrom(row.time)
        addEntry(row, dateFrom(row.date), mealFrom(undefined, time), row['food name'] ?? '', time)
        break
      }
    }
  }
  return { format, entries, weights, skipped }
}

