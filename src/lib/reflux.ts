import type { DiaryEntry, Symptom } from '../types'
import { shiftDate } from './utils'

/**
 * Reflux watch: points out foods that are common heartburn triggers for many people. It reads food names only,
 * never diagnoses, and says "common", never "bad": triggers differ from person to person.
 */
const TRIGGERS: Array<[label: string, words: string[]]> = [
  ['coffee', ['coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'macchiato', 'mocha']],
  ['alcohol', ['alcoholic', 'beer', 'wine', 'vodka', 'whiskey', 'whisky', 'rum', 'gin', 'tequila', 'cocktail', 'margarita', 'sake']],
  ['chocolate', ['chocolate', 'cocoa', 'brownie', 'brownies']],
  ['mint', ['mint', 'peppermint', 'spearmint']],
  ['citrus', ['orange', 'oranges', 'lemon', 'lemons', 'lemonade', 'lime', 'limes', 'grapefruit', 'citrus', 'tangerine', 'tangerines', 'clementine']],
  ['tomato', ['tomato', 'tomatoes', 'marinara', 'salsa', 'ketchup', 'catsup', 'pizza']],
  ['spicy food', ['spicy', 'chili', 'chilli', 'chile', 'jalapeno', 'jalapenos', 'habanero', 'sriracha', 'cayenne', 'hot sauce', 'curry', 'vindaloo']],
  ['fizzy drinks', ['soda', 'cola', 'sparkling', 'seltzer', 'carbonated', 'tonic', 'sprite']],
  ['fried food', ['fried', 'fries', 'tempura', 'nuggets', 'donut', 'doughnut', 'onion rings']],
  ['onion and garlic', ['onion', 'onions', 'garlic']],
]

/** A single entry with this much fat counts as a heavy, fatty meal, another common trigger. */
export const FATTY_MEAL_GRAMS = 25
/** Eating from this hour on counts as late, since lying down soon after a meal is a common trigger. */
export const LATE_HOUR = 20

export interface RefluxDay {
  /** Distinct trigger labels found today, in the order they were first eaten. */
  triggers: string[]
  lateMeal: boolean
  /** 0 calm, 1 one or two triggers, 2 three or more triggers or a late heavy meal. */
  level: 0 | 1 | 2
}

export const triggersIn = (name: string): string[] => {
  const text = ` ${name.toLowerCase().replace(/[^a-z]+/g, ' ')} `
  return TRIGGERS.filter(([, words]) => words.some((word) => text.includes(` ${word} `))).map(([label]) => label)
}

export const refluxDay = (entries: DiaryEntry[], today: string): RefluxDay => {
  const eaten = entries
    .filter((entry) => !entry.planned && entry.date === today)
    .sort((left, right) => (left.time ?? '').localeCompare(right.time ?? ''))
  const triggers: string[] = []
  const add = (label: string) => { if (!triggers.includes(label)) triggers.push(label) }
  for (const entry of eaten) {
    triggersIn(entry.name).forEach(add)
    if (entry.fat >= FATTY_MEAL_GRAMS) add('a fatty meal')
  }
  const lateMeal = eaten.some((entry) => entry.time !== undefined && Number(entry.time.slice(0, 2)) >= LATE_HOUR && (entry.calories >= 300 || entry.fat >= 15))
  const level = triggers.length >= 3 || (lateMeal && triggers.length >= 1) ? 2 : triggers.length >= 1 || lateMeal ? 1 : 0
  return { triggers, lateMeal, level }
}

/** "coffee, tomato and chocolate" */
export const listTriggers = (labels: string[]): string => (labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`)

/** How long before a flare a food still counts as "before it". */
export const FLARE_WINDOW_HOURS = 3

export interface TriggerFinding {
  label: string
  /** Flares that had this trigger in the hours before them (or earlier the same day when times are missing). */
  flaresWithTrigger: number
  flares: number
  /** Logged days in the window on which the trigger was eaten at all. */
  daysWithTrigger: number
  loggedDays: number
  /** How much more often the trigger shows up before flares than on an ordinary logged day. 1 means no pattern. */
  lift: number
}

export interface RefluxReport {
  days: number
  flares: number
  loggedDays: number
  /** Flares by part of day: morning (before 12), afternoon (12 to 18), evening (18 to 22), night (22 to 4). */
  byPeriod: { morning: number; afternoon: number; evening: number; night: number }
  /** Needs at least this many flares before any pattern is shown. */
  enough: boolean
  findings: TriggerFinding[]
}

export const MIN_FLARES_FOR_PATTERNS = 5

const minutes = (time?: string) => (time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : undefined)
const periodFor = (time?: string): keyof RefluxReport['byPeriod'] => {
  const hour = time ? Number(time.slice(0, 2)) : 20
  if (hour >= 22 || hour < 4) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
const triggerLabelsFor = (entry: DiaryEntry): string[] => [...triggersIn(entry.name), ...(entry.fat >= FATTY_MEAL_GRAMS ? ['a fatty meal'] : [])]

/**
 * Which common triggers show up before this person's flares more than on their ordinary days. It is a pattern, not a
 * cause: a trigger eaten every day will sit at a lift near 1 even if it matters, and a rare one can look large by chance,
 * so findings need several flares before they are shown and are worded as "came before", never "caused".
 */
export const refluxReport = (entries: DiaryEntry[], symptoms: Symptom[], today: string, days = 30): RefluxReport => {
  const start = shiftDate(today, -(days - 1))
  const eaten = entries.filter((entry) => !entry.planned && entry.date >= start && entry.date <= today)
  const flares = symptoms.filter((symptom) => symptom.date >= start && symptom.date <= today)
  const loggedDays = new Set(eaten.map((entry) => entry.date))
  const byPeriod = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  for (const flare of flares) byPeriod[periodFor(flare.time)] += 1

  const daysWith = new Map<string, Set<string>>()
  for (const entry of eaten) for (const label of triggerLabelsFor(entry)) {
    if (!daysWith.has(label)) daysWith.set(label, new Set())
    daysWith.get(label)!.add(entry.date)
  }
  const beforeFlare = new Map<string, Set<string>>()
  for (const flare of flares) {
    const flareMinutes = minutes(flare.time)
    const before = eaten.filter((entry) => {
      if (entry.date !== flare.date) return false
      const entryMinutes = minutes(entry.time)
      if (flareMinutes === undefined || entryMinutes === undefined) return true
      return entryMinutes <= flareMinutes && flareMinutes - entryMinutes <= FLARE_WINDOW_HOURS * 60
    })
    for (const entry of before) for (const label of triggerLabelsFor(entry)) {
      if (!beforeFlare.has(label)) beforeFlare.set(label, new Set())
      beforeFlare.get(label)!.add(flare.id)
    }
  }
  const enough = flares.length >= MIN_FLARES_FOR_PATTERNS && loggedDays.size >= 7
  const findings: TriggerFinding[] = enough
    ? [...daysWith.keys()].map((label) => {
      const flaresWithTrigger = beforeFlare.get(label)?.size ?? 0
      const daysWithTrigger = daysWith.get(label)?.size ?? 0
      const flareRate = flaresWithTrigger / flares.length
      const dayRate = daysWithTrigger / loggedDays.size
      return { label, flaresWithTrigger, flares: flares.length, daysWithTrigger, loggedDays: loggedDays.size, lift: dayRate > 0 ? flareRate / dayRate : 0 }
    }).filter((finding) => finding.flaresWithTrigger >= 2 && finding.lift >= 1.5).sort((left, right) => right.lift - left.lift || right.flaresWithTrigger - left.flaresWithTrigger).slice(0, 4)
    : []
  return { days, flares: flares.length, loggedDays: loggedDays.size, byPeriod, enough, findings }
}
