import type { Goals } from '../types'
import { dateFromISO } from './utils'

/**
 * Uneven calorie days ("calorie shifting"). The daily goal stays the average; `goals.calorieShift` holds seven kcal
 * deltas, Sunday to Saturday, that sum to zero, so a week at the targets always adds up to 7 x the daily goal.
 * Macro goals (protein, carbs, fat) are plain grams the person typed or the check-in set, not derived from the day's
 * calories, so they are the same every day and shifting leaves them alone.
 */

/** Never plan a day below this. Matches the program's safety floor. */
export const MIN_DAY_KCAL = 1200
/** The same cap one diary entry has; a day's target is held to it too. */
export const MAX_DAY_KCAL = 10000
export const SHIFT_STEP = 50
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Biggest change one weekday may carry. */
export const MAX_DELTA_KCAL = 5000
export const SHIFT_REDUCED_NOTE = 'Your weekday shift was reduced to keep every day at 1,200 kcal or more.'
export const SHIFT_CLEARED_NOTE = 'Your weekday shift was removed because every day must stay at 1,200 kcal or more.'
export const SHIFT_DROPPED_NOTE = 'Your weekday shift was removed because there is no calorie goal.'

/**
 * The stored deltas when this build can use them: seven finite numbers, each within +-5000, that sum to zero (within 1 kcal) once
 * rounded to whole kcal. Anything else counts as "no shift" for display and calculation, but is left stored as it is.
 */
export const readCalorieShift = (goals: { calorieShift?: unknown } | undefined): number[] | undefined => {
  const raw = goals?.calorieShift
  if (!Array.isArray(raw) || raw.length !== 7) return undefined
  if (!raw.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_DELTA_KCAL)) return undefined
  const shift = (raw as number[]).map((value) => Math.round(value) + 0)
  if (Math.abs(sum(shift)) > 1 || shift.every((value) => value === 0)) return undefined
  return shift
}

export function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }

/**
 * The calorie target for one day: the daily goal plus that weekday's shift, or just the goal when no shift is set.
 * Undefined without a positive goal. A shift never takes the day under the safety floor (or under the goal itself, when the goal is already lower).
 */
export type ShiftGoals = Partial<Omit<Goals, 'calorieShift'>> & { calorieShift?: unknown }
export const targetFor = (goals: ShiftGoals | undefined, date: string): number | undefined => {
  const goal = goals?.calories
  if (goal === undefined || !Number.isFinite(goal) || !(goal > 0)) return goal
  const shift = readCalorieShift(goals)
  if (!shift) return goal
  const delta = shift[dateFromISO(date).getDay()] ?? 0
  // A defensive floor for stored data from another build. Every write in this build keeps the days at or above it, so it never changes a target here.
  return Math.max(Math.min(goal, MIN_DAY_KCAL), goal + delta)
}

/** The seven targets as the diary uses them, with the floor applied. */
export const effectiveTargets = (goal: number, shift: number[]): number[] => shift.map((delta) => Math.max(Math.min(goal, MIN_DAY_KCAL), goal + delta))

/**
 * Keep a shift valid when the daily goal changes: if any goal + delta would fall under 1,200 kcal, scale the deltas down so the lowest
 * day sits at 1,200 and rebalance to a zero sum in 10 kcal steps; clear it when the goal itself is at or under 1,200.
 */
export const adjustShiftForGoal = (goal: number, shift: number[]): { shift?: number[]; change?: 'reduced' | 'cleared' } => {
  const lowest = Math.min(...shift)
  if (goal + lowest >= MIN_DAY_KCAL) return { shift }
  if (goal <= MIN_DAY_KCAL) return { change: 'cleared' }
  const factor = (goal - MIN_DAY_KCAL) / -lowest
  // Cuts round toward zero and rises to the nearest 10, so no day ends under the floor.
  const scaled = shift.map((delta) => (delta < 0 ? Math.ceil((delta * factor) / 10) * 10 : Math.round((delta * factor) / 10) * 10))
  const balanced = rebalance(goal, scaled, [0, 1, 2, 3, 4, 5, 6])
  if (sum(balanced) !== 0 || Math.min(...balanced) + goal < MIN_DAY_KCAL || balanced.every((delta) => delta === 0)) return { change: 'cleared' }
  return { shift: balanced, change: 'reduced' }
}

const withoutShift = <T extends { calorieShift?: unknown }>(goals: T): T => {
  const { calorieShift: _removed, ...rest } = goals
  return rest as T
}
/** Goals about to be saved with a new calorie goal: a stored shift this build can read is kept valid for it. A shift it cannot read is left alone. */
export const reconcileGoalsShift = <T extends { calories?: number; calorieShift?: unknown }>(goals: T): { goals: T; note?: string } => {
  const shift = readCalorieShift(goals)
  if (!shift) return { goals }
  const goal = goals.calories
  if (goal === undefined || !(goal > 0)) return { goals: withoutShift(goals), note: SHIFT_DROPPED_NOTE }
  const adjusted = adjustShiftForGoal(goal, shift)
  if (!adjusted.change) return { goals }
  if (!adjusted.shift) return { goals: withoutShift(goals), note: SHIFT_CLEARED_NOTE }
  return { goals: { ...goals, calorieShift: adjusted.shift }, note: SHIFT_REDUCED_NOTE }
}

/** Average target over the given days (days with no goal are ignored); undefined when there is no goal. */
export const averageTarget = (goals: Parameters<typeof targetFor>[0], dates: string[]): number | undefined => {
  const targets = dates.map((date) => targetFor(goals, date)).filter((value): value is number => value !== undefined && value > 0)
  return targets.length ? sum(targets) / targets.length : undefined
}

/** True when a usable shift is stored. */
export const hasShift = (goals: Parameters<typeof targetFor>[0]): boolean => readCalorieShift(goals) !== undefined && (goals?.calories ?? 0) > 0

export const weeklyTotal = (goal: number): number => goal * 7

/** The seven resulting targets, Sunday first. */
export const dayTargets = (goal: number, shift: number[]): number[] => shift.map((delta) => goal + delta)

/** Why these deltas cannot be saved, or undefined when they can. */
export const shiftProblem = (goal: number | undefined, shift: number[]): string | undefined => {
  if (shift.every((value) => value === 0)) return undefined
  if (goal === undefined || !(goal > 0)) return 'Set a calorie goal first.'
  if (shift.length !== 7 || shift.some((value) => !Number.isFinite(value))) return 'Every day needs a number.'
  const total = sum(shift)
  if (total !== 0) return `The days add up to ${Math.abs(total).toLocaleString()} kcal ${total > 0 ? 'more' : 'less'} than the weekly total. Use Balance to fix it.`
  const low = dayTargets(goal, shift).findIndex((value) => value < MIN_DAY_KCAL)
  if (low !== -1) return `${WEEKDAY_NAMES[low]} would be under ${MIN_DAY_KCAL.toLocaleString()} kcal. Raise it to at least ${MIN_DAY_KCAL.toLocaleString()}.`
  const high = dayTargets(goal, shift).findIndex((value) => value > MAX_DAY_KCAL)
  if (high !== -1) return `${WEEKDAY_NAMES[high]} would be over ${MAX_DAY_KCAL.toLocaleString()} kcal.`
  return undefined
}

/**
 * Make the deltas sum to zero by moving the difference onto the `eligible` days (all days by default), 10 kcal at a time
 * (the last step takes whatever remains): taking off from the day with the highest target, adding to the one with the lowest.
 * Days are kept at or above the floor while another eligible day has room.
 */
export const rebalance = (goal: number, shift: number[], eligible?: number[]): number[] => {
  const next = [...shift]
  // By default the days the person has not moved absorb the difference, so Balance does not undo what they just set.
  const untouched = [0, 1, 2, 3, 4, 5, 6].filter((day) => next[day] === 0)
  const days = eligible ?? (untouched.length ? untouched : [0, 1, 2, 3, 4, 5, 6])
  let remainder = -sum(next)
  if (!days.length) return next
  for (let guard = 0; remainder !== 0 && guard < 20000; guard += 1) {
    const step = Math.sign(remainder) * Math.min(10, Math.abs(remainder))
    const usable = days.filter((day) => (step < 0 ? goal + next[day] + step >= MIN_DAY_KCAL : goal + next[day] + step <= MAX_DAY_KCAL))
    const pool = usable.length ? usable : days
    // Ties go to the earliest day in the list, so the result is the same every time.
    const day = pool.reduce((best, candidate) => (step < 0 ? (next[candidate] > next[best] ? candidate : best) : (next[candidate] < next[best] ? candidate : best)))
    next[day] += step
    remainder -= step
  }
  return next
}

const roundTo10 = (value: number) => Math.round(value / 10) * 10

/**
 * About 10% more on Saturday and Sunday, taken evenly off Monday to Friday, in 10 kcal steps and re-balanced to sum to zero.
 * Weekdays are never taken under 1,200 kcal: when the goal is too close to that, the weekend bump shrinks to match.
 * Returns all zeros when the goal leaves no room (a goal under 1,210 kcal).
 */
export const higherWeekends = (goal: number): number[] => {
  const room = Math.floor((goal - MIN_DAY_KCAL) / 10) * 10
  if (!(room >= 10)) return [0, 0, 0, 0, 0, 0, 0]
  const bump = roundTo10(goal * 0.1)
  const take = roundTo10((bump * 2) / 5)
  if (take + 10 <= room) return rebalance(goal, [bump, -take, -take, -take, -take, -take, bump], [1, 2, 3, 4, 5])
  const capped = Math.min(take, room)
  const smaller = Math.floor((capped * 5) / 2 / 10) * 10
  return rebalance(goal, [smaller, -capped, -capped, -capped, -capped, -capped, smaller], [1, 2, 3, 4, 5])
}

/** A usable delta from a typed or stepped target, kept whole. */
export const deltaFromTarget = (goal: number, target: number): number => Math.round(target - goal)
