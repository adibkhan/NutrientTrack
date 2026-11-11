import type { DiaryEntry, MealCategory } from '../types'
import { mealForTime } from './utils'

/** How far back the ranking looks, and how fast older entries fade. */
export const HISTORY_DAYS = 60
export const HALF_LIFE_DAYS = 14
/** An entry with a time counts when it was logged within this many minutes of now (around midnight too). */
export const TIME_WINDOW_MINUTES = 90
/** Fewer past entries than this and there is no "usual" yet. */
export const MIN_HISTORY = 5
export const MAX_USUAL = 12
/** Weight of an entry with no time whose meal matches the meal for the clock. */
const MEAL_ONLY_WEIGHT = 0.5
const SAME_WEEKDAY_BOOST = 1.2

const DAY_MS = 86_400_000
const dayNumber = (year: number, month: number, day: number): number => Math.floor(Date.UTC(year, month, day) / DAY_MS)

/** Every reading below uses the clock's local calendar fields only, so the result never depends on the machine's time zone offset. */
const parseDate = (value: string): { day: number; weekday: number } | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const utc = new Date(Date.UTC(year, month, date))
  return { day: dayNumber(year, month, date), weekday: utc.getUTCDay() }
}

const minutesOf = (time: string): number | undefined => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

const clockTime = (now: Date): string => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

/** "Usual for Lunch" for the meal being logged; with no meal chosen, the meal for the clock, and "Usual for now" between meals. */
export const usualLabel = (now: Date, chosen?: MealCategory): string => {
  const meal = chosen ?? mealForTime(clockTime(now))
  if (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner') return `Usual for ${meal[0].toUpperCase()}${meal.slice(1)}`
  return chosen === 'snack' ? 'Usual for Snacks' : 'Usual for now'
}

/** Two entries are the same usual food when name and calorie snapshot match. */
export const usualKey = (entry: Pick<DiaryEntry, 'name' | 'calories'>): string => `${entry.name.trim().toLocaleLowerCase()}|${Math.round(entry.calories)}`

/**
 * What this person usually logs around this time of day, best first. Score per food = sum over its entries in the last 60 days of
 * recency (half-life 14 days) x time-of-day closeness (within 90 minutes of now; an entry with no time counts at half weight when its
 * meal is the meal for the clock) x 1.2 on the same weekday. Planned entries and future days are ignored. Fewer than 5 past entries
 * return nothing. With `meal` (the meal being logged to, e.g. from "Add to Dinner", or any meal on a day that is not today) the clock is
 * ignored: entries of that meal count at full weight and the rest not at all. Ties break on the newest entry, then name, then id, so the order never changes between renders.
 */
export const smartHistory = (entries: readonly DiaryEntry[], now: Date, limit: number = MAX_USUAL, meal?: MealCategory): DiaryEntry[] => {
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate())
  const weekday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).getUTCDay()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const clockMeal = mealForTime(clockTime(now))

  const groups = new Map<string, { score: number; latest: DiaryEntry }>()
  let past = 0
  for (const entry of entries) {
    if (entry.planned) continue
    const when = parseDate(entry.date)
    if (!when) continue
    const age = today - when.day
    if (age < 0 || age > HISTORY_DAYS) continue
    past += 1
    let closeness = 0
    const minutes = entry.time ? minutesOf(entry.time) : undefined
    if (meal) {
      closeness = entry.meal === meal ? 1 : 0
    } else if (minutes !== undefined) {
      const gap = Math.abs(minutes - nowMinutes)
      const distance = Math.min(gap, 1440 - gap)
      if (distance <= TIME_WINDOW_MINUTES) closeness = 1 - (0.5 * distance) / TIME_WINDOW_MINUTES
    } else if (entry.meal === clockMeal) {
      closeness = MEAL_ONLY_WEIGHT
    }
    const key = usualKey(entry)
    const group = groups.get(key) ?? { score: 0, latest: entry }
    if (closeness > 0) group.score += Math.pow(0.5, age / HALF_LIFE_DAYS) * closeness * (when.weekday === weekday ? SAME_WEEKDAY_BOOST : 1)
    if (newer(entry, group.latest)) group.latest = entry
    groups.set(key, group)
  }
  if (past < MIN_HISTORY) return []
  return [...groups.values()]
    .filter((group) => group.score > 0)
    .sort((a, b) => {
      const diff = Math.round((b.score - a.score) * 1e9)
      if (diff !== 0) return diff
      if (a.latest.updatedAt !== b.latest.updatedAt) return a.latest.updatedAt > b.latest.updatedAt ? -1 : 1
      return a.latest.name.localeCompare(b.latest.name) || a.latest.id.localeCompare(b.latest.id)
    })
    .slice(0, limit)
    .map((group) => group.latest)
}

const newer = (a: DiaryEntry, b: DiaryEntry): boolean => a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id)
