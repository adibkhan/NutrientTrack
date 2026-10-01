import type { DiaryEntry, MacroKey, MacroTotals, MealCategory } from '../types'

export const todayISO = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const dateFromISO = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export const isoFromDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const shiftDate = (value: string, days: number): string => {
  const date = dateFromISO(value)
  date.setDate(date.getDate() + days)
  return isoFromDate(date)
}

export const formatDateLabel = (value: string, options: Intl.DateTimeFormatOptions = {}): string => {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...options,
  }).format(dateFromISO(value))
}

/** An "HH:MM" wall-clock time in the viewer's own clock style (e.g. "7:40 AM"); unreadable values come back unchanged. */
export const formatClockTime = (time: string): string => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return time
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2020, 0, 1, Number(match[1]), Number(match[2])))
}

export const formatShortDate = (value: string): string => {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(dateFromISO(value))
}

export const formatNumber = (value: number, maximumFractionDigits = 0): string => {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)
}

export const formatInputNumber = (value: number | undefined): string => {
  return value === undefined ? '' : String(value)
}

export const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const nowISO = (): string => new Date().toISOString()

export const sumEntries = (entries: DiaryEntry[]): MacroTotals =>
  entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      protein: sum.protein + entry.protein,
      carbs: sum.carbs + entry.carbs,
      fat: sum.fat + entry.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )

export const macroLabel = (key: MacroKey): string => {
  if (key === 'protein') return 'Protein'
  if (key === 'carbs') return 'Carbs'
  return 'Fat'
}

/** The meal a food most likely belongs to at an "HH:MM" wall-clock time; 'other' when the time is unreadable. */
export const mealForTime = (time: string): MealCategory => {
  const match = /^([01]\d|2[0-3]):[0-5]\d$/.exec(time)
  if (!match) return 'other'
  const hour = Number(match[1])
  if (hour >= 5 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 22) return 'dinner'
  return 'snack'
}

export const clampPercent = (value: number): number => Math.max(0, Math.min(value, 100))

export const isDateToday = (value: string): boolean => value === todayISO()
