import type { WeightEntry } from '../types'
import { dateFromISO } from './utils'

/**
 * Each day between weigh-ins moves the trend a tenth of the way toward the scale, so one odd morning barely shows. The
 * weight given to a reading grows with the time since the last one: after a three-week gap the new reading is mostly
 * believed, instead of being treated like a next-day reading.
 */
export const TREND_SMOOTHING = 0.1

const DAY_MS = 86_400_000

export const LB_PER_KG = 2.2046226218

export const convertWeight = (weight: number, from: 'lb' | 'kg', to: 'lb' | 'kg'): number => {
  if (from === to) return weight
  return from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG
}

export type TrendedWeight = WeightEntry & { trend: number }

/** The smoothed trend after each check-in. Entries must be sorted oldest first and share one unit. */
export const withTrend = (entries: WeightEntry[]): TrendedWeight[] => {
  let trend: number | undefined
  let previousDate: string | undefined
  return entries.map((entry) => {
    if (trend === undefined || previousDate === undefined) {
      trend = entry.weight
    } else {
      // At least one day, so two readings on the same date each count as a next-day reading.
      const days = Math.max(1, Math.round((dateFromISO(entry.date).getTime() - dateFromISO(previousDate).getTime()) / DAY_MS))
      trend += (1 - (1 - TREND_SMOOTHING) ** days) * (entry.weight - trend)
    }
    previousDate = entry.date
    return { ...entry, trend }
  })
}

/** Every check-in in one unit, oldest first, with its trend. Bad rows (non-finite or non-positive weight) are skipped. */
export const trendSeries = (weights: WeightEntry[], unit: 'lb' | 'kg'): TrendedWeight[] =>
  withTrend(weights
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .map((entry) => ({ ...entry, weight: convertWeight(entry.weight, entry.unit, unit), unit }))
    // Two weigh-ins on one day keep the order they were logged in, so the later one is the "latest".
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')))
