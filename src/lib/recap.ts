import type { DiaryEntry, Goals, WeightEntry } from '../types'
import { averageTarget, hasShift } from './calorieShift'
import { loggingStreak } from './mascot'
import { trendSeries } from './trend'
import { shiftDate } from './utils'

export interface WeeklyRecap {
  /** First and last day of the window, inclusive. */
  start: string
  end: string
  daysLogged: number
  /** Each of the seven days, oldest first, and whether anything eaten was logged. */
  days: Array<{ date: string; logged: boolean }>
  foodsLogged: number
  /** Averages over logged days only; a day with nothing logged is missing, not zero. */
  avgCalories?: number
  avgProtein?: number
  /** Average calorie target over the logged days; only set when uneven calorie days are on. */
  avgTarget?: number
  streak: number
  /** Change in trend weight across the window, in `unit`, when at least two weigh-ins fall inside it. */
  trendChange?: number
}

/** The seven days ending on `today`. Planned entries never count. */
export const weeklyRecap = (entries: DiaryEntry[], weights: WeightEntry[], today: string, unit: 'lb' | 'kg', goals?: Goals): WeeklyRecap => {
  const start = shiftDate(today, -6)
  const eaten = entries.filter((entry) => !entry.planned)
  const inWindow = eaten.filter((entry) => entry.date >= start && entry.date <= today)
  const byDay = new Map<string, { calories: number; protein: number }>()
  for (const entry of inWindow) {
    const day = byDay.get(entry.date) ?? { calories: 0, protein: 0 }
    day.calories += entry.calories
    day.protein += entry.protein
    byDay.set(entry.date, day)
  }
  const totals = [...byDay.values()]
  const average = (pick: (day: { calories: number; protein: number }) => number) => (totals.length ? totals.reduce((sum, day) => sum + pick(day), 0) / totals.length : undefined)
  const trended = trendSeries(weights, unit).filter((weight) => weight.date >= start && weight.date <= today)
  const trendChange = trended.length >= 2 ? trended[trended.length - 1].trend - trended[0].trend : undefined
  return {
    start,
    end: today,
    daysLogged: byDay.size,
    days: Array.from({ length: 7 }, (_, index) => { const date = shiftDate(start, index); return { date, logged: byDay.has(date) } }),
    foodsLogged: inWindow.length,
    avgCalories: average((day) => day.calories),
    avgProtein: average((day) => day.protein),
    ...(hasShift(goals) ? { avgTarget: averageTarget(goals, [...byDay.keys()]) } : {}),
    streak: loggingStreak(eaten, today),
    trendChange,
  }
}

/** Whole-number display that stays short: 9,800 stays as is, 12345 becomes 12.3k, 1234567 becomes 1.2M. */
export const compactCount = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const trim = (n: number) => String(Math.round(n * 10) / 10)
  if (abs >= 999_950) return `${trim(value / 1_000_000)}M`
  if (abs >= 10_000) return `${trim(value / 1000)}k`
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}
