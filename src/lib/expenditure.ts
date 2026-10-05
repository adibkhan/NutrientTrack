import type { DiaryEntry, WeightEntry } from '../types'
import { dateFromISO, shiftDate } from './utils'
import { trendSeries } from './trend'

export const KCAL_PER_LB = 3500
export const EXPENDITURE_WINDOW_DAYS = 28

export type Confidence = 'low' | 'medium' | 'high'

export type ExpenditureEstimate =
  | {
      kind: 'ok'
      /** Estimated daily energy burn, kcal. */
      kcalPerDay: number
      avgIntake: number
      loggedDays: number
      windowDays: number
      weighIns: number
      /** Trend weight change across the span, in pounds. Negative means weight went down. */
      trendChangeLb: number
      spanDays: number
      /** Average intake minus expenditure, kcal/day. Negative is a deficit. */
      impliedBalance: number
      confidence: Confidence
    }
  | { kind: 'insufficient'; reason: string; loggedDays: number; weighIns: number }

const daysBetween = (from: string, to: string): number =>
  Math.round((dateFromISO(to).getTime() - dateFromISO(from).getTime()) / 86_400_000)

/** Slope (y per x) of the least-squares line through the points; 0 when x does not vary. */
const regressionSlope = (points: Array<{ x: number; y: number }>): number => {
  const n = points.length
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n
  let covariance = 0
  let variance = 0
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY)
    variance += (point.x - meanX) ** 2
  }
  return variance === 0 ? 0 : covariance / variance
}

const MIN_LOGGED_DAYS = 14
const MIN_WEIGH_INS = 4
const MIN_SPAN_DAYS = 14

/**
 * Infer daily energy expenditure from what was eaten and how the trend weight moved:
 * expenditure = average intake - (weight change in kcal) / days, with the change read from a line fitted to the scale weights. Uses only days with food logged and only eaten
 * (not planned) entries, so a missed day never reads as a zero-calorie day. Returns "insufficient" with a plain
 * reason instead of a number when the data cannot support one.
 */
export const estimateExpenditure = (entries: DiaryEntry[], weights: WeightEntry[], endDate: string, windowDays = EXPENDITURE_WINDOW_DAYS): ExpenditureEstimate => {
  const startDate = shiftDate(endDate, -(windowDays - 1))
  const intakeByDay = new Map<string, number>()
  for (const entry of entries) {
    if (entry.planned || entry.date < startDate || entry.date > endDate || !Number.isFinite(entry.calories)) continue
    intakeByDay.set(entry.date, (intakeByDay.get(entry.date) ?? 0) + entry.calories)
  }
  const loggedDays = intakeByDay.size
  const series = trendSeries(weights, 'lb')
  const inWindow = series.filter((entry) => entry.date >= startDate && entry.date <= endDate)
  const insufficient = (reason: string): ExpenditureEstimate => ({ kind: 'insufficient', reason, loggedDays, weighIns: inWindow.length })

  if (loggedDays < MIN_LOGGED_DAYS) return insufficient(`Log food on at least ${MIN_LOGGED_DAYS} of the last ${windowDays} days. You have ${loggedDays}.`)
  if (inWindow.length < MIN_WEIGH_INS) return insufficient(`Log your weight at least ${MIN_WEIGH_INS} times in the last ${windowDays} days. You have ${inWindow.length}.`)
  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  const spanDays = daysBetween(first.date, last.date)
  if (spanDays < MIN_SPAN_DAYS) return insufficient(`Your weigh-ins need to span at least ${MIN_SPAN_DAYS} days. They span ${spanDays}.`)

  let intakeTotal = 0
  intakeByDay.forEach((calories) => { intakeTotal += calories })
  const avgIntake = intakeTotal / loggedDays
  // A least-squares line through the scale readings, not the smoothed trend: the trend lags a real change, which would
  // under-read the deficit and suggest too small a budget when there are only a few weeks of data.
  const trendChangeLb = regressionSlope(inWindow.map((entry) => ({ x: daysBetween(first.date, entry.date), y: entry.weight }))) * spanDays
  const kcalPerDay = avgIntake - (trendChangeLb * KCAL_PER_LB) / spanDays
  if (!Number.isFinite(kcalPerDay) || kcalPerDay < 800 || kcalPerDay > 6000) {
    return insufficient('The logged intake and weight changes do not add up to a believable number yet. Check for missing days or a mistyped weight.')
  }
  const coverage = loggedDays / windowDays
  const confidence: Confidence = coverage >= 0.85 && inWindow.length >= 8 ? 'high' : coverage >= 0.6 && inWindow.length >= 5 ? 'medium' : 'low'
  return {
    kind: 'ok',
    kcalPerDay: Math.round(kcalPerDay),
    avgIntake: Math.round(avgIntake),
    loggedDays,
    windowDays,
    weighIns: inWindow.length,
    trendChangeLb,
    spanDays,
    impliedBalance: Math.round(avgIntake - kcalPerDay),
    confidence,
  }
}
