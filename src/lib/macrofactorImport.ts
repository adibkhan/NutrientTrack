import type { MealCategory } from '../types'
import { parseDecimalDetailed } from './decimal'
import { MACROFACTOR_DAY_TOTAL } from './importPlan'
import { dateFrom, mealFrom, parseCsv, timeFrom, type ImportedEntry, type ImportedWeight } from './importers'
import { LIMITS } from './limits'
import { NUTRIENTS, type NutrientKey, type NutrientValues } from './nutrients'
import { roundNutrient } from './servings'
import { LB_PER_KG } from './trend'
import { shiftDate, todayISO } from './utils'
import type { Sheet } from './xlsx'

/**
 * MacroFactor's Data Export (More > Data Management > Data Export) is an .xlsx with one sheet per kind of data.
 * We have not seen every version of it, so sheets are recognised by their column names (any case, any spacing, a few
 * synonyms), never by position. Foods, scale weights and daily totals are imported; trend, expenditure, target and
 * program sheets are read but not stored, because NutrientTrack recalculates or does not use them.
 */

export const EXPENDITURE_NOTE = "Expenditure history isn't imported; NutrientTrack recalculates it from your weights and food."

export type SheetKind = 'food' | 'daily' | 'weight' | 'trend' | 'skipped' | 'unknown'
export type DateOrder = 'mdy' | 'dmy'
export interface SheetReport {
  name: string
  kind: SheetKind
  /** Entries (food or day totals) read from the sheet. */
  imported: number
  /** Weigh-ins read from a sheet that also holds intake. */
  alsoWeights?: number
  /** Rows that could not be read: bad date, missing or out-of-range or unreadable numbers. */
  skipped: number
  /** The weight unit was not in the file, so the unit picked in the panel was used. */
  assumedUnit?: boolean
  /** Dates like 01/05/2026 can be read two ways and the file does not settle it. */
  askDateOrder?: { example: string; used: DateOrder }
  note?: string
}
export interface MacroFactorParse {
  entries: ImportedEntry[]
  weights: ImportedWeight[]
  skipped: number
  sheets: SheetReport[]
}

interface Header { full: string; base: string }
const headerOf = (value: string): Header => {
  const full = value.trim().toLowerCase().replace(/\s+/g, ' ')
  return { full, base: full.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() }
}

const SYNONYMS = {
  date: ['date', 'day'],
  time: ['time', 'time of day', 'logged at', 'timestamp'],
  name: ['food name', 'name', 'food', 'item', 'description'],
  calories: ['calories', 'energy', 'kcal'],
  protein: ['protein'],
  carbs: ['carbs', 'carbohydrates', 'carbohydrate'],
  fat: ['fat', 'total fat'],
  weight: ['scale weight', 'weight', 'body weight'],
  trend: ['trend weight', 'weight trend', 'trend'],
  expenditure: ['expenditure', 'tdee', 'maintenance calories'],
  bodyFat: ['body fat', 'body fat %', 'body fat percentage', 'body fat percent', 'bodyfat', 'bodyfat %', 'fat percent', 'fat %', 'bf %'],
  unit: ['unit', 'units', 'weight unit'],
} as const

/** Header names (case and spacing ignored, units in brackets stripped) for each nutrient the app stores. */
const NUTRIENT_SYNONYMS: Record<NutrientKey, string[]> = {
  fiber: ['fiber', 'fibre', 'dietary fiber', 'dietary fibre'], sodium: ['sodium'], sugar: ['sugar', 'sugars', 'total sugars'], satFat: ['saturated fat', 'saturated', 'sat fat', 'saturated fats'],
  cholesterol: ['cholesterol'], monoFat: ['monounsaturated fat', 'monounsaturated', 'mono fat', 'monounsaturated fats'], polyFat: ['polyunsaturated fat', 'polyunsaturated', 'poly fat', 'polyunsaturated fats'],
  transFat: ['trans fat', 'trans fats', 'trans'], omega3: ['omega-3', 'omega 3', 'omega3', 'omega-3 fatty acids', 'omega 3 fatty acids'],
  potassium: ['potassium'], calcium: ['calcium'], iron: ['iron'], magnesium: ['magnesium'], phosphorus: ['phosphorus', 'phosphorous'], zinc: ['zinc'], copper: ['copper'], manganese: ['manganese'], selenium: ['selenium'],
  vitaminA: ['vitamin a', 'vitamin a rae'], vitaminC: ['vitamin c', 'ascorbic acid'], vitaminD: ['vitamin d', 'vitamin d3'], vitaminE: ['vitamin e'], vitaminK: ['vitamin k'],
  thiamin: ['thiamin', 'thiamine', 'vitamin b1', 'b1'], riboflavin: ['riboflavin', 'vitamin b2', 'b2'], niacin: ['niacin', 'vitamin b3', 'b3'], vitaminB6: ['vitamin b6', 'b6'],
  folate: ['folate', 'folic acid', 'vitamin b9', 'b9'], vitaminB12: ['vitamin b12', 'b12'], choline: ['choline'], caffeine: ['caffeine'], alcohol: ['alcohol'], water: ['water'],
}
const UNIT_MG: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, ug: 0.001, 'µg': 0.001, 'μg': 0.001 }
const unitInHeader = (full: string): string | undefined => {
  const match = /\(([^)]*)\)/.exec(full)
  return match ? match[1].trim().toLowerCase().replace(/\s+/g, ' ') : undefined
}
/** Multiplier from a header's unit to the app's unit for that nutrient; undefined when the column cannot be converted (IU for anything but vitamin D, vitamin A that is not mcg RAE, ml, kcal ...). */
const unitFactor = (key: NutrientKey, full: string): number | undefined => {
  const target = NUTRIENTS.find((nutrient) => nutrient.key === key)?.unit as string
  const unit = unitInHeader(full)
  if (unit === undefined || unit === '') return key === 'vitaminA' ? undefined : 1
  if (unit === 'iu') return key === 'vitaminD' ? 1 / 40 : undefined
  const source = unit.replace(/\s*rae$/, '').trim()
  if (key === 'vitaminA' && !/rae|mcg|ug|µg|μg/.test(unit)) return undefined
  if (!(source in UNIT_MG) || !(target in UNIT_MG)) return undefined
  return UNIT_MG[source] / UNIT_MG[target]
}
type NutrientColumn = { position: number; key: NutrientKey; factor: number }
type Column = keyof typeof SYNONYMS
type Columns = Partial<Record<Column, number>>
/** Nutrient columns found, and the ones skipped because their unit cannot be converted. */
const findNutrientColumns = (headers: Header[], used: number[]): { found: NutrientColumn[]; skipped: string[] } => {
  const found: NutrientColumn[] = []
  const skipped: string[] = []
  const claimed = new Set<NutrientKey>()
  headers.forEach((header, position) => {
    if (used.includes(position)) return
    const base = header.base.replace(/[_]+/g, ' ')
    const key = (Object.keys(NUTRIENT_SYNONYMS) as NutrientKey[]).find((candidate) => NUTRIENT_SYNONYMS[candidate].includes(base))
    if (!key || claimed.has(key)) return
    const factor = unitFactor(key, header.full)
    if (factor === undefined) { skipped.push(header.full); return }
    claimed.add(key)
    found.push({ position, key, factor })
  })
  return { found, skipped }
}

const findColumns = (headers: Header[]): { columns: Columns; kilojoules: boolean } => {
  const columns: Columns = {}
  let kilojoules = false
  for (const column of Object.keys(SYNONYMS) as Column[]) {
    const candidates: number[] = []
    for (const synonym of SYNONYMS[column]) headers.forEach((header, position) => { if (header.base === synonym && !Object.values(columns).includes(position)) candidates.push(position) })
    if (candidates.length === 0) continue
    // An energy column in kilojoules is used only when there is no kilocalorie one.
    const chosen = column === 'calories' ? (candidates.find((position) => !/\bkj\b|kilojoule/.test(headers[position].full)) ?? candidates[0]) : candidates[0]
    columns[column] = chosen
    if (column === 'calories' && /\bkj\b|kilojoule/.test(headers[chosen].full)) kilojoules = true
  }
  return { columns, kilojoules }
}

const NOT_STORED_NAME = /target|goal|program|plan|recommend/i
const TREND_NAME = /expenditure|trend/i
const MICRO_SHEET_NAME = /micro\s*nutrient/i

const unitIn = (text: string): 'kg' | 'lb' | 'st' | undefined =>
  /\b(kg|kgs|kilograms?)\b/i.test(text) ? 'kg' : /\b(st|stone|stones)\b/i.test(text) ? 'st' : /\b(lb|lbs|pounds?)\b/i.test(text) ? 'lb' : undefined

interface Table {
  intake?: 'food' | 'daily'
  weight: boolean
  trend: boolean
  columns: Columns
  kilojoules: boolean
  nutrients: NutrientColumn[]
  /** Nutrient columns left out because their unit cannot be converted (IU, ml). */
  skippedColumns: string[]
  headers: Header[]
  headerRow: number
}
const HEADER_SEARCH_ROWS = 30

/** Find the header row (it need not be the first), then say what the table holds. */
const locateTable = (rows: string[][]): Table | undefined => {
  for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index += 1) {
    const headers = rows[index].map(headerOf)
    const { columns, kilojoules } = findColumns(headers)
    if (columns.date === undefined) continue
    const intake = columns.name !== undefined && columns.calories !== undefined ? 'food' : columns.calories !== undefined && (columns.protein !== undefined || columns.carbs !== undefined || columns.fat !== undefined) ? 'daily' : undefined
    // A "Weight" column next to food is only a body weight when it says kg, lb or st (not grams of food).
    const weight = columns.weight !== undefined && (intake === undefined || unitIn(headers[columns.weight].full) !== undefined || columns.unit !== undefined)
    const trend = !intake && !weight && (columns.trend !== undefined || columns.expenditure !== undefined)
    if (intake || weight || trend) {
      const { found, skipped } = intake ? findNutrientColumns(headers, Object.values(columns) as number[]) : { found: [], skipped: [] }
      return { intake, weight, trend, columns, kilojoules, nutrients: found, skippedColumns: skipped, headers, headerRow: index }
    }
  }
  return undefined
}

const pad = (value: number) => String(value).padStart(2, '0')
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits

/** A number from a cell. Blank is missing; anything unreadable or that could be read two ways ("2,000", "0x10") is bad. */
type Num = { value?: number; bad?: true }
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const readNumber = (text: string | undefined, storedAsNumber: boolean): Num => {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return {}
  if (storedAsNumber) return PLAIN_NUMBER.test(trimmed) && Number.isFinite(Number(trimmed)) ? { value: Number(trimmed) } : { bad: true }
  const { value, reason } = parseDecimalDetailed(trimmed)
  return reason || !Number.isFinite(value) ? { bad: true } : { value }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** An Excel serial number as an ISO date in the 1900 (or 1904) date system. Pure UTC arithmetic, so the time zone never matters. */
export const dateFromSerial = (serial: number, date1904 = false): string | undefined => {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return undefined
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const moment = new Date(base + Math.floor(serial) * 86_400_000)
  return dateFrom(`${moment.getUTCFullYear()}-${moment.getUTCMonth() + 1}-${moment.getUTCDate()}`)
}
/** The time of day held in the fraction of a serial number, as "HH:MM". A fraction that rounds to midnight stays on the same day, as 23:59. */
export const timeFromFraction = (fraction: number): string | undefined => {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) return undefined
  const minutes = Math.min(1439, Math.round(fraction * 1440))
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** Which order the browser's own language writes a slash date in. */
export const localeDateOrder = (): DateOrder => {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2000, 0, 31))
    const month = parts.findIndex((part) => part.type === 'month')
    const day = parts.findIndex((part) => part.type === 'day')
    return day !== -1 && month !== -1 && day < month ? 'dmy' : 'mdy'
  } catch {
    return 'mdy'
  }
}

const SLASH_DATE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})$/
const TRAILING_TIME = /(?:^|[\sT])(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[ap]\.?m\.?)?)\s*(?:Z|[+-]\d{2}:?\d{2})?$/i
const splitTime = (text: string): { datePart: string; timePart?: string } => {
  const match = TRAILING_TIME.exec(text)
  return match ? { datePart: text.slice(0, match.index).trim(), timePart: match[1] } : { datePart: text.trim() }
}

interface OrderEvidence { firstOver12: boolean; secondOver12: boolean; ambiguous?: string; dots: boolean }
/** What a column of text dates says about day-first or month-first. */
const orderEvidence = (cells: string[]): OrderEvidence => {
  const evidence: OrderEvidence = { firstOver12: false, secondOver12: false, dots: false }
  for (const cell of cells) {
    const match = SLASH_DATE.exec(splitTime(cell.trim()).datePart)
    if (!match) continue
    const first = Number(match[1])
    const second = Number(match[3])
    if (match[2] === '.') evidence.dots = true
    if (first > 12) evidence.firstOver12 = true
    else if (second > 12) evidence.secondOver12 = true
    else if (first !== second && evidence.ambiguous === undefined) evidence.ambiguous = cell.trim()
  }
  return evidence
}

const inRange = (date: string | undefined, today: string): string | undefined => (date && date >= '2000-01-01' && date <= shiftDate(today, 1) ? date : undefined)

/** A date cell: ISO, 2026/01/05, 20260105, slash or dot dates in the given order, "Oct 1, 2026", or an Excel serial number. A trailing time is kept. */
const cellDate = (value: string | undefined, storedAsNumber: boolean, order: DateOrder, date1904: boolean, today: string): { date?: string; time?: string } => {
  const text = (value ?? '').trim()
  if (!text) return {}
  if (storedAsNumber && /^\d{4,7}(\.\d+)?$/.test(text) && Number(text) < 1_000_000) {
    const serial = Number(text)
    return { date: inRange(dateFromSerial(serial, date1904), today), time: serial % 1 ? timeFromFraction(serial % 1) : undefined }
  }
  const { datePart, timePart } = splitTime(text)
  const time = timePart ? timeFrom(timePart.replace(/\.\d+/, '')) : undefined
  let date: string | undefined
  let match: RegExpExecArray | null
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(datePart)) || (match = /^(\d{4})(\d{2})(\d{2})$/.exec(datePart))) date = dateFrom(`${match[1]}-${Number(match[2])}-${Number(match[3])}`)
  else if ((match = SLASH_DATE.exec(datePart))) {
    let [first, second] = [Number(match[1]), Number(match[3])]
    const year = match[4].length === 2 ? 2000 + Number(match[4]) : Number(match[4])
    if (first > 12 && second <= 12) [first, second] = [second, first]
    else if (!(second > 12) && order === 'dmy') [first, second] = [second, first]
    date = dateFrom(`${year}-${first}-${second}`)
  } else if ((match = /^(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(datePart))) {
    const month = MONTHS.indexOf(match[1].toLowerCase()) + 1
    if (month > 0) date = dateFrom(`${match[3]}-${month}-${match[2]}`)
  } else if ((match = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(datePart))) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1
    if (month > 0) date = dateFrom(`${match[3]}-${month}-${match[1]}`)
  }
  return { date: inRange(date, today), time }
}
const cellTime = (value: string | undefined, storedAsNumber: boolean): string | undefined => {
  const text = (value ?? '').trim()
  if (!text) return undefined
  if (storedAsNumber && PLAIN_NUMBER.test(text)) return timeFromFraction(Number(text) % 1)
  return timeFrom(text)
}

const hash = (text: string) => {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(36)
}
/** Same id scheme as importers.ts (a repeated key gets a counter), so the CSV and xlsx imports of one food share an id. */
const stableIds = () => {
  const seen = new Map<string, number>()
  return (prefix: string, key: string) => {
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return `import-${prefix}-${hash(key)}${count ? `-${count}` : ''}`
  }
}

export interface ParseOptions {
  /** The unit weigh-ins are stored in. */
  targetUnit: 'lb' | 'kg'
  /** The unit to assume for a weight column that does not say. */
  assumedUnit: 'lb' | 'kg'
  date1904?: boolean
  /** Settles slash dates that the file itself leaves open. */
  dateOrder?: DateOrder
  /** Today as an ISO date, for the "not in the future" check. */
  today?: string
}

const KG_PER_STONE = 6.35029318
const toKilograms = (value: number, unit: 'kg' | 'lb' | 'st') => (unit === 'kg' ? value : unit === 'st' ? value * KG_PER_STONE : value / LB_PER_KG)
const convertWeight = (value: number, unit: 'kg' | 'lb' | 'st', target: 'lb' | 'kg') => (unit === target ? value : target === 'kg' ? toKilograms(value, unit) : unit === 'st' ? value * 14 : value * LB_PER_KG)

/** Read every recognisable sheet. Bad rows are counted, never fatal. */
export const parseMacroFactorSheets = (sheets: Sheet[], options: ParseOptions): MacroFactorParse => {
  const entries: ImportedEntry[] = []
  const weights: ImportedWeight[] = []
  const reports: SheetReport[] = []
  const idFor = stableIds()
  const today = options.today ?? todayISO()
  const dayTotalDates = new Set<string>()
  let skipped = 0

  // A sheet named like "Scale Weight" is read before other weight sheets, so its weigh-ins win a day.
  const ordered = sheets.map((sheet, index) => ({ sheet, index })).sort((a, b) => Number(/scale/i.test(b.sheet.name)) - Number(/scale/i.test(a.sheet.name)) || a.index - b.index)
  const results: Array<{ index: number; report: SheetReport }> = []

  for (const { sheet, index: sheetIndex } of ordered) {
    const report: SheetReport = { name: sheet.name, kind: 'unknown', imported: 0, skipped: 0 }
    results.push({ index: sheetIndex, report })
    if (sheet.hidden) { report.note = 'Hidden sheet, skipped.'; continue }
    if (MICRO_SHEET_NAME.test(sheet.name)) { report.kind = 'skipped'; report.note = "Not imported: the Micronutrients daily sheet. Micronutrients come in with each food on the food log sheet."; continue }
    if (TREND_NAME.test(sheet.name)) { report.kind = 'trend'; report.note = EXPENDITURE_NOTE; continue }
    if (NOT_STORED_NAME.test(sheet.name)) { report.kind = 'skipped'; report.note = 'Not imported: targets and programs are not diary data.'; continue }
    const table = locateTable(sheet.rows)
    if (!table) { report.note = "We didn't recognise this sheet. Tell us if a sheet didn't import."; continue }
    const { columns, headers } = table
    report.kind = table.intake ?? (table.weight ? 'weight' : 'trend')
    if (report.kind === 'trend') report.note = EXPENDITURE_NOTE
    if (table.skippedColumns.length > 0) report.note = `Columns not imported (unit can't be converted): ${table.skippedColumns.join(', ')}.`
    const data = sheet.rows.slice(table.headerRow + 1)
    const kinds = (rowIndex: number, column: Column) => (columns[column] === undefined ? false : sheet.rowKinds?.[table.headerRow + 1 + rowIndex]?.[columns[column] as number] === 'n')
    const cell = (row: string[], column: Column) => (columns[column] === undefined ? undefined : row[columns[column] as number])
    const bad = () => { report.skipped += 1 }

    // Day-first or month-first, decided once for the whole date column.
    let order: DateOrder = options.dateOrder ?? localeDateOrder()
    if (columns.date !== undefined) {
      const textDates = data.filter((_row, rowIndex) => !kinds(rowIndex, 'date')).map((row) => cell(row, 'date') ?? '')
      const evidence = orderEvidence(textDates)
      if (evidence.firstOver12 && !evidence.secondOver12) order = 'dmy'
      else if (evidence.secondOver12 && !evidence.firstOver12) order = 'mdy'
      else if (!evidence.firstOver12 && !evidence.secondOver12 && evidence.ambiguous !== undefined) {
        if (!options.dateOrder) order = evidence.dots ? 'dmy' : localeDateOrder()
        report.askDateOrder = { example: evidence.ambiguous, used: order }
      }
    }
    const when = (row: string[], rowIndex: number) => cellDate(cell(row, 'date'), kinds(rowIndex, 'date'), order, options.date1904 ?? false, today)

    if (table.intake) {
      const kind = table.intake
      data.forEach((row, rowIndex) => {
        const { date, time: dateTime } = when(row, rowIndex)
        const caloriesRead = readNumber(cell(row, 'calories'), kinds(rowIndex, 'calories'))
        const name = kind === 'food' ? (cell(row, 'name') ?? '').trim() : MACROFACTOR_DAY_TOTAL
        if (!date || !name || caloriesRead.bad || caloriesRead.value === undefined) { bad(); return }
        const calories = table.kilojoules ? caloriesRead.value / 4.184 : caloriesRead.value
        if (calories < 0 || calories > LIMITS.calories) { bad(); return }
        const macros: Record<'protein' | 'carbs' | 'fat', number> = { protein: 0, carbs: 0, fat: 0 }
        for (const key of ['protein', 'carbs', 'fat'] as const) {
          const read = readNumber(cell(row, key), kinds(rowIndex, key))
          if (read.bad || (read.value !== undefined && (read.value < 0 || read.value > LIMITS.macro))) { bad(); return }
          if (read.value !== undefined) macros[key] = round(read.value)
        }
        const extras: NutrientValues = {}
        for (const column of table.nutrients) {
          const read = readNumber(row[column.position], sheet.rowKinds?.[table.headerRow + 1 + rowIndex]?.[column.position] === 'n')
          if (read.bad || (read.value !== undefined && read.value * column.factor > LIMITS.nutrient)) { bad(); return }
          if (read.value !== undefined && read.value >= 0) extras[column.key] = roundNutrient(column.key, read.value * column.factor)
        }
        if (kind === 'daily') {
          if (calories === 0) { bad(); return }
          // One total per day across the whole workbook: the first sheet that has the day wins.
          if (dayTotalDates.has(date)) { bad(); return }
          dayTotalDates.add(date)
          entries.push({ id: idFor('macrofactor-daily', `${date}|${round(calories, 1)}`), date, meal: 'other', name, calories: round(calories, 1), ...macros, ...extras, importedFrom: 'macrofactor', importedKind: 'day-total' })
        } else {
          const time = cellTime(cell(row, 'time'), kinds(rowIndex, 'time')) ?? dateTime
          const meal: MealCategory = mealFrom(undefined, time)
          entries.push({
            id: idFor('macrofactor-food', [date, time ?? '', meal, name, round(calories, 1)].join('|')),
            date, meal, name: name.slice(0, LIMITS.nameLength), calories: round(calories, 1), ...macros, ...(time ? { time } : {}), ...extras, importedFrom: 'macrofactor',
          })
        }
        report.imported += 1
      })
    }

    if (table.weight) {
      const weightHeader = headers[columns.weight as number]
      const headerUnit = unitIn(weightHeader.full)
      if (headerUnit === 'st' && headers.some((header, position) => position !== columns.weight && /\b(lb|lbs|pounds?)\b/.test(header.full))) {
        report.note = "Weights split into stones and pounds aren't supported. Export in kg or lb."
        skipped += report.skipped
        continue
      }
      type Candidate = { date: string; value: number; unit: 'kg' | 'lb' | 'st'; bodyFat?: number; percentText: boolean }
      const candidates: Candidate[] = []
      let weightsSkipped = 0
      data.forEach((row, rowIndex) => {
        const { date } = when(row, rowIndex)
        const read = readNumber(cell(row, 'weight'), kinds(rowIndex, 'weight'))
        const unitText = cell(row, 'unit')
        const rowUnit = headerUnit ?? (unitText ? unitIn(unitText) : undefined)
        const unit = rowUnit ?? options.assumedUnit
        const kilograms = read.value === undefined ? undefined : toKilograms(read.value, unit)
        if (table.intake && read.value === undefined && !read.bad) return
        if (!date || read.bad || read.value === undefined || kilograms === undefined || !(kilograms >= 1 && kilograms <= 700)) { weightsSkipped += 1; return }
        if (rowUnit === undefined) report.assumedUnit = true
        const rawFat = (cell(row, 'bodyFat') ?? '').trim()
        const percentText = rawFat.includes('%')
        const fat = readNumber(rawFat.replace('%', ''), kinds(rowIndex, 'bodyFat'))
        candidates.push({ date, value: read.value, unit, bodyFat: fat.bad ? undefined : fat.value, percentText })
      })
      // Body fat of 1 or less is a fraction only when every value in the column is.
      const fats = candidates.filter((candidate) => candidate.bodyFat !== undefined)
      const asFraction = fats.length > 0 && fats.every((candidate) => (candidate.bodyFat as number) <= 1 && !candidate.percentText)
      for (const candidate of candidates) {
        const percent = candidate.bodyFat === undefined ? undefined : asFraction ? candidate.bodyFat * 100 : candidate.bodyFat
        weights.push({
          id: idFor('macrofactor-weight', `${candidate.date}|${candidate.value}|${candidate.unit}`),
          date: candidate.date, weight: round(convertWeight(candidate.value, candidate.unit, options.targetUnit), 2), unit: options.targetUnit,
          ...(percent !== undefined && percent > 0 && percent < 100 ? { bodyFat: round(percent, 1) } : {}),
          importedFrom: 'macrofactor',
        })
      }
      if (table.intake) report.alsoWeights = candidates.length
      else report.imported += candidates.length
      report.skipped += weightsSkipped
    }
    if (!report.assumedUnit) delete report.assumedUnit
    skipped += report.skipped
  }
  for (const { report } of results.sort((a, b) => a.index - b.index)) reports.push(report)
  return { entries, weights, skipped, sheets: reports }
}

const sniffDelimiter = (text: string): string => {
  const line = text.replace(/^﻿/, '').split(/\r?\n/).find((candidate) => candidate.trim() !== '') ?? ''
  const count = (character: string) => line.split(character).length - 1
  const best = [',', ';', '\t'].reduce((winner, character) => (count(character) > count(winner) ? character : winner), ',')
  return best
}

/** A CSV export of one sheet (comma, semicolon or tab separated), read as a workbook of one sheet named after the file. */
export const parseMacroFactorCsv = (text: string, fileName: string, options: ParseOptions): MacroFactorParse =>
  parseMacroFactorSheets([{ name: fileName.replace(/\.[^.]+$/, ''), rows: parseCsv(text, sniffDelimiter(text)) }], options)

export { MACROFACTOR_DAY_TOTAL, dropCoveredDayTotals } from './importPlan'
