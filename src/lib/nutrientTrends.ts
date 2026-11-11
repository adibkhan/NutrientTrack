import type { DiaryEntry } from '../types'
import type { ContributorRange } from './contributors'
import { NUTRIENT_KEYS, NUTRIENTS, type NutrientInfo } from './nutrients'
import { shiftDate } from './utils'

/** An average over fewer fully recorded days than this is shown, but ranked below the rest and marked "Not enough data yet". */
export const MIN_RECORDED_DAYS = 3
/** A day counts toward a nutrient only when the foods that recorded it make up at least this share of the day's eaten calories. */
export const MIN_RECORDED_SHARE = 0.8
/** Days under this many eaten calories (a lone snack) are left out of every average. */
export const MIN_DAY_KCAL = 600

type MetricKey = 'calories' | 'protein' | 'carbs' | 'fat' | (typeof NUTRIENT_KEYS)[number]
const METRIC_KEYS: MetricKey[] = ['calories', 'protein', 'carbs', 'fat', ...NUTRIENT_KEYS]

interface DayTotals {
  kcal: number
  /** Per metric: the day's total over foods that recorded it, the calories of those foods, and whether any did. */
  value: Float64Array
  kcalWith: Float64Array
  has: Uint8Array
}

/** One pass over the range: per-day totals of every metric. Shared by the Trends card and the contributors table. */
export interface RangeTotals {
  /** Days with at least one eaten food. */
  loggedDays: number
  days: DayTotals[]
}

const cache = new WeakMap<DiaryEntry[], Map<string, RangeTotals>>()

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)

/** Totals per day over the last `days` days ending on `endDate`, planned foods left out. Memoized per entries array, end date and range. */
export const rangeTotals = (entries: DiaryEntry[], endDate: string, days: ContributorRange): RangeTotals => {
  let byRange = cache.get(entries)
  if (!byRange) cache.set(entries, (byRange = new Map()))
  const cacheKey = `${endDate}|${days}`
  const hit = byRange.get(cacheKey)
  if (hit) return hit
  const startDate = shiftDate(endDate, -(days - 1))
  const byDate = new Map<string, DayTotals>()
  for (const entry of entries) {
    if (entry.planned || entry.date < startDate || entry.date > endDate) continue
    let day = byDate.get(entry.date)
    if (!day) byDate.set(entry.date, (day = { kcal: 0, value: new Float64Array(METRIC_KEYS.length), kcalWith: new Float64Array(METRIC_KEYS.length), has: new Uint8Array(METRIC_KEYS.length) }))
    const kcal = finite(entry.calories) ?? 0
    day.kcal += kcal
    for (let index = 0; index < METRIC_KEYS.length; index += 1) {
      const value = finite(entry[METRIC_KEYS[index]])
      if (value === undefined) continue
      day.value[index] += value
      day.kcalWith[index] += kcal
      day.has[index] = 1
    }
  }
  const result: RangeTotals = { loggedDays: byDate.size, days: [...byDate.values()] }
  byRange.set(cacheKey, result)
  return result
}

export interface NutrientTrendRow {
  info: NutrientInfo
  /** Average per fully recorded day. Days where the nutrient was mostly unrecorded are left out, never counted as zero. */
  average: number
  /** Days the average covers, out of `loggedDays` days of at least MIN_DAY_KCAL. */
  recordedDays: number
  loggedDays: number
  /** Average as a share of the daily value (1 = 100%); undefined for nutrients with no daily value. */
  share?: number
  /** Fewer than MIN_RECORDED_DAYS days: "Not enough data yet". */
  thin: boolean
}

export interface NutrientTrends {
  /** Days in the range with at least one eaten food. */
  loggedDays: number
  /** Days under MIN_DAY_KCAL, left out of the averages. */
  skippedDays: number
  /** True when rows exist but none has MIN_RECORDED_DAYS days behind it. */
  notEnoughYet: boolean
  /** Nutrients with a daily value that people aim to reach, lowest share first (biggest shortfall on top). */
  aim: NutrientTrendRow[]
  /** Nutrients with a daily value that people keep under, highest share first (biggest overage on top). */
  limit: NutrientTrendRow[]
  /** Nutrients with data but no daily value, in list order. */
  other: NutrientTrendRow[]
}

/**
 * Averages per nutrient over the last `days` days. Entries logged before a nutrient was tracked (or logged by hand) carry no value
 * for it, so a day only counts toward a nutrient when the foods that recorded it are at least MIN_RECORDED_SHARE of that day's
 * calories, and days under MIN_DAY_KCAL are skipped. A nutrient with no such day has no row. Rows with fewer than
 * MIN_RECORDED_DAYS such days are ranked after the rest.
 */
export const summarizeNutrientTrends = (entries: DiaryEntry[], endDate: string, days: ContributorRange): NutrientTrends => {
  const totals = rangeTotals(entries, endDate, days)
  const eligible = totals.days.filter((day) => day.kcal >= MIN_DAY_KCAL)
  const aim: NutrientTrendRow[] = []
  const limit: NutrientTrendRow[] = []
  const other: NutrientTrendRow[] = []
  for (const info of NUTRIENTS) {
    const index = METRIC_KEYS.indexOf(info.key)
    let sum = 0
    let counted = 0
    for (const day of eligible) {
      if (!day.has[index] || day.kcalWith[index] < MIN_RECORDED_SHARE * day.kcal) continue
      sum += day.value[index]
      counted += 1
    }
    if (counted === 0) continue
    const average = sum / counted
    const share = info.dv === undefined ? undefined : average / info.dv
    const row: NutrientTrendRow = { info, average, recordedDays: counted, loggedDays: eligible.length, thin: counted < MIN_RECORDED_DAYS, ...(share !== undefined ? { share } : {}) }
    if (share === undefined) other.push(row)
    else if (info.kind === 'limit') limit.push(row)
    else aim.push(row)
  }
  const thinLast = (a: NutrientTrendRow, b: NutrientTrendRow) => Number(a.thin) - Number(b.thin)
  aim.sort((a, b) => thinLast(a, b) || (a.share ?? 0) - (b.share ?? 0))
  limit.sort((a, b) => thinLast(a, b) || (b.share ?? 0) - (a.share ?? 0))
  const all = [...aim, ...limit, ...other]
  return { loggedDays: totals.loggedDays, skippedDays: totals.loggedDays - eligible.length, notEnoughYet: all.length > 0 && all.every((row) => row.thin), aim, limit, other }
}

/** "9 of 30 days fully recorded" when the average leaves days out; empty when it covers every counted day. */
export const coverageNote = (row: Pick<NutrientTrendRow, 'recordedDays' | 'loggedDays'>): string =>
  row.recordedDays < row.loggedDays ? `${row.recordedDays} of ${row.loggedDays} days fully recorded` : ''

/** Whole-number percent of a daily value. */
export const percentOfDv = (value: number, dv: number): number => Math.round((value / dv) * 100)

/** Average per logged day that recorded each metric (calories, macros and nutrients), from one pass: for the contributors table. */
export const recordedAverages = (entries: DiaryEntry[], endDate: string, days: ContributorRange): Map<string, number> => {
  const totals = rangeTotals(entries, endDate, days)
  const result = new Map<string, number>()
  METRIC_KEYS.forEach((key, index) => {
    let sum = 0
    let counted = 0
    for (const day of totals.days) {
      if (!day.has[index]) continue
      sum += day.value[index]
      counted += 1
    }
    if (counted > 0) result.set(key, sum / counted)
  })
  return result
}
