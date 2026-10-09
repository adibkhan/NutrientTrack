import type { DiaryEntry, Goals, Program, Settings, WeightEntry } from '../types'
import { dateFromISO, shiftDate } from './utils'
import { estimateExpenditure, KCAL_PER_LB, type ExpenditureEstimate } from './expenditure'
import { LB_PER_KG, trendSeries } from './trend'

/** Never suggest a daily budget below this, whatever the rate asks for. */
export const MIN_BUDGET_KCAL = 1200
/** Fat share of the budget when the app splits macros itself (the balanced style). */
export const FAT_SHARE = 0.3

/** Diet styles: what share of the budget goes to fat once protein is set. Carbohydrate is whatever remains. */
export const DIET_STYLES = {
  balanced: { label: 'Balanced', fatShare: FAT_SHARE },
  lowfat: { label: 'Lower fat', fatShare: 0.2 },
  lowcarb: { label: 'Lower carb', fatShare: 0.4 },
  keto: { label: 'Keto', fatShare: 0.65 },
} as const

export type DietStyle = keyof typeof DIET_STYLES

/** A trend this far from a maintain goal weight gets a small push back toward it. */
export const MAINTENANCE_BAND_LB = 1.5
export const MAINTENANCE_NUDGE_KCAL = 250

const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

/** Read a program from a stored record that may come from another build; malformed fields count as "not set". */
export const readProgram = (value: unknown): Program => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const program: Program = {}
  if (raw.direction === 'lose' || raw.direction === 'maintain' || raw.direction === 'gain') program.direction = raw.direction
  if (isPositive(raw.goalWeight)) program.goalWeight = raw.goalWeight
  if (isPositive(raw.weeklyRate)) program.weeklyRate = raw.weeklyRate
  if (isPositive(raw.proteinPerWeight)) program.proteinPerWeight = raw.proteinPerWeight
  if (typeof raw.dietStyle === 'string' && Object.prototype.hasOwnProperty.call(DIET_STYLES, raw.dietStyle)) program.dietStyle = raw.dietStyle as DietStyle
  if (typeof raw.checkInDay === 'number' && Number.isInteger(raw.checkInDay) && raw.checkInDay >= 0 && raw.checkInDay <= 6) program.checkInDay = raw.checkInDay
  if (typeof raw.lastCheckIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastCheckIn)) program.lastCheckIn = raw.lastCheckIn
  return program
}

/** Weight change per week that the program asks for, in its own unit: negative to lose, positive to gain. */
const signedWeeklyChange = (program: Program): number => {
  if (program.direction === 'lose') return -(program.weeklyRate ?? 0)
  if (program.direction === 'gain') return program.weeklyRate ?? 0
  return 0
}

export interface Budget {
  calories: number
  protein?: number
  carbs?: number
  fat?: number
  /** True when the rate asked for less than the safety floor and the budget was held at the floor. */
  floored: boolean
  /** A maintain program's push toward its goal weight, kcal a day: positive adds food, negative takes some away. */
  nudge?: number
}

/**
 * Maintaining is not "stay exactly here": when the trend has drifted more than a pound and a half from the goal weight,
 * add or take away a modest amount so it eases back instead of settling at the new weight.
 */
export const maintenanceNudge = (program: Program, unit: 'lb' | 'kg', trendWeightInUnit?: number): number => {
  if (program.direction !== 'maintain' || program.goalWeight === undefined || trendWeightInUnit === undefined || !(trendWeightInUnit > 0)) return 0
  const diffLb = (program.goalWeight - trendWeightInUnit) * (unit === 'kg' ? LB_PER_KG : 1)
  if (Math.abs(diffLb) <= MAINTENANCE_BAND_LB) return 0
  return diffLb > 0 ? MAINTENANCE_NUDGE_KCAL : -MAINTENANCE_NUDGE_KCAL
}

/** The daily budget that moves the trend at the program's rate, given an estimated expenditure. */
export const budgetFor = (program: Program, unit: 'lb' | 'kg', expenditure: number, trendWeightInUnit?: number): Budget => {
  const changeLb = unit === 'kg' ? signedWeeklyChange(program) * LB_PER_KG : signedWeeklyChange(program)
  const nudge = maintenanceNudge(program, unit, trendWeightInUnit)
  const raw = expenditure + (changeLb * KCAL_PER_LB) / 7 + nudge
  const calories = Math.round(Math.max(MIN_BUDGET_KCAL, raw))
  const protein = program.proteinPerWeight !== undefined && trendWeightInUnit !== undefined ? Math.round(program.proteinPerWeight * trendWeightInUnit) : undefined
  const fat = Math.round((calories * DIET_STYLES[program.dietStyle ?? 'balanced'].fatShare) / 9)
  const carbs = protein === undefined ? undefined : Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))
  return { calories, ...(protein !== undefined ? { protein, carbs, fat } : {}), floored: raw < MIN_BUDGET_KCAL, ...(nudge !== 0 ? { nudge } : {}) }
}

/**
 * The program re-expressed in another weight unit. Goal weight, weekly rate and the protein ratio are all stored as plain
 * numbers in the unit the person chose, so switching pounds to kilograms must convert them or the goal silently reads wrong.
 * Everything else on the record, including fields from other builds, is kept as it is. Anything that is not an object is returned unchanged.
 */
export const convertProgramUnit = <T>(program: T, from: 'lb' | 'kg', to: 'lb' | 'kg'): T => {
  if (from === to || !program || typeof program !== 'object' || Array.isArray(program)) return program
  const next = { ...(program as Record<string, unknown>) }
  const convert = (key: string, digits: number, factor: number) => {
    const value = next[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) next[key] = Math.round(value * factor * 10 ** digits) / 10 ** digits
  }
  const weightFactor = from === 'lb' ? 1 / LB_PER_KG : LB_PER_KG
  convert('goalWeight', 1, weightFactor)
  convert('weeklyRate', 2, weightFactor)
  // Grams of protein per pound become grams per kilogram by the inverse factor.
  convert('proteinPerWeight', 2, 1 / weightFactor)
  return next as T
}

/** One line for a goal: "11.6 lb to go · by Dec 24, 2026", "Goal reached", or "Goal weight reached" for maintain. */
export const describeGoalProgress = (progress: GoalProgress, unit: 'lb' | 'kg'): string => {
  if (progress.reached) return 'Reached'
  const amount = `${Math.round(progress.remaining * 10) / 10} ${unit}`
  if (!progress.projectedDate) return amount
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${progress.projectedDate}T12:00:00`))
  return `${amount} · by ${date}`
}

export interface GoalProgress {
  /** Amount still to go in the weight unit, 0 once reached. */
  remaining: number
  /** Projected date of reaching the goal at the program's rate, when a rate is set. */
  projectedDate?: string
  reached: boolean
}

export const goalProgress = (program: Program, trendWeight: number, today: string): GoalProgress | undefined => {
  if (program.goalWeight === undefined || !(trendWeight > 0)) return undefined
  const diff = program.goalWeight - trendWeight
  const reached = program.direction === 'maintain' ? Math.abs(diff) < 0.5 : program.direction === 'gain' ? diff <= 0 : diff >= 0
  const remaining = reached ? 0 : Math.abs(diff)
  if (reached || !program.weeklyRate || program.direction === 'maintain') return { remaining, reached }
  return { remaining, reached, projectedDate: shiftDate(today, Math.ceil((remaining / program.weeklyRate) * 7)) }
}

/** The most recent date on or before `today` that falls on the check-in weekday. */
export const lastCheckInDate = (today: string, checkInDay: number): string => {
  const weekday = dateFromISO(today).getDay()
  return shiftDate(today, -((weekday - checkInDay + 7) % 7))
}

export const isCheckInDue = (program: Program, today: string): boolean => {
  if (program.checkInDay === undefined || program.direction === undefined) return false
  return program.lastCheckIn === undefined || program.lastCheckIn < lastCheckInDate(today, program.checkInDay)
}

/** Fewest logged days in the week that a check-in will adjust the budget from. */
export const MIN_CHECKIN_DAYS = 4

export interface CheckIn {
  /** The check-in day itself: what lastCheckIn records, so the card stops being due once it is answered. */
  dueDate: string
  weekEnding: string
  daysLogged: number
  avgIntake?: number
  /** Trend change over the week in the weight unit; undefined without weigh-ins on both sides. */
  trendChange?: number
  unit: 'lb' | 'kg'
  expenditure: ExpenditureEstimate
  currentBudget?: number
  newBudget?: Budget
  /** Plain-language summary of how the week went against the program. */
  headline: string
}

/** The weekly review: the seven days ending on the check-in date, plus the budget the program now suggests. */
export const buildCheckIn = (entries: DiaryEntry[], weights: WeightEntry[], settings: Settings | undefined, today: string): CheckIn | undefined => {
  const program = readProgram(settings?.program)
  const goals: Goals = settings?.goals ?? { weightUnit: 'lb' }
  if (program.direction === undefined || program.checkInDay === undefined) return undefined
  const dueDate = lastCheckInDate(today, program.checkInDay)
  // On the check-in day itself the week is the seven finished days before it; today is still being logged.
  const weekEnding = dueDate === today ? shiftDate(today, -1) : dueDate
  const weekStart = shiftDate(weekEnding, -6)
  const unit = goals.weightUnit
  const week = new Map<string, number>()
  for (const entry of entries) {
    if (entry.planned || entry.date < weekStart || entry.date > weekEnding) continue
    week.set(entry.date, (week.get(entry.date) ?? 0) + entry.calories)
  }
  const daysLogged = week.size
  let total = 0
  week.forEach((calories) => { total += calories })
  const avgIntake = daysLogged > 0 ? Math.round(total / daysLogged) : undefined
  const series = trendSeries(weights, unit)
  const before = [...series].reverse().find((entry) => entry.date < weekStart)
  const after = [...series].reverse().find((entry) => entry.date <= weekEnding)
  const trendChange = before && after && before.date !== after.date ? after.trend - before.trend : undefined
  const expenditure = estimateExpenditure(entries, weights, weekEnding)
  const newBudget = expenditure.kind === 'ok' ? budgetFor(program, unit, expenditure.kcalPerDay, after?.trend) : undefined
  let headline: string
  if (daysLogged < MIN_CHECKIN_DAYS) headline = 'Not enough logged days to adjust. Log food on at least four days next week.'
  else if (expenditure.kind !== 'ok') headline = 'The budget stays as it is until there is enough data to estimate your expenditure.'
  else if (newBudget && goals.calories !== undefined && newBudget.calories === goals.calories) headline = 'On track. The budget stays the same.'
  else if (newBudget && goals.calories !== undefined) headline = `The budget ${newBudget.calories > goals.calories ? 'rises' : 'falls'} by ${Math.abs(newBudget.calories - goals.calories)} kcal.`
  else headline = 'A budget is ready to set from your program.'
  return { dueDate, weekEnding, daysLogged, avgIntake, trendChange, unit, expenditure, currentBudget: goals.calories, newBudget, headline }
}
