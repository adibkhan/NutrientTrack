import type { WeightEntry } from '../types'

/** Each check-in moves the trend a tenth of the way toward the scale reading, so one odd morning barely shows. */
export const TREND_SMOOTHING = 0.1

export const LB_PER_KG = 2.2046226218

export const convertWeight = (weight: number, from: 'lb' | 'kg', to: 'lb' | 'kg'): number => {
  if (from === to) return weight
  return from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG
}

export type TrendedWeight = WeightEntry & { trend: number }

/** The smoothed trend after each check-in. Entries must be sorted oldest first and share one unit. */
export const withTrend = (entries: WeightEntry[]): TrendedWeight[] => {
  let trend: number | undefined
  return entries.map((entry) => {
    trend = trend === undefined ? entry.weight : trend + TREND_SMOOTHING * (entry.weight - trend)
    return { ...entry, trend }
  })
}

/** Every check-in in one unit, oldest first, with its trend. Bad rows (non-finite or non-positive weight) are skipped. */
export const trendSeries = (weights: WeightEntry[], unit: 'lb' | 'kg'): TrendedWeight[] =>
  withTrend(weights
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .map((entry) => ({ ...entry, weight: convertWeight(entry.weight, entry.unit, unit), unit }))
    .sort((a, b) => a.date.localeCompare(b.date)))
