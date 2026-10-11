import type { DiaryEntry, Goals, MealCategory, Preferences, WeightEntry } from '../types'
import { shiftDate } from './utils'
import { pipGrowth } from './pipGrowth'
import { listTriggers, refluxDay } from './reflux'

/** Pip, the logging buddy. Every line is chosen on the device from the diary itself; nothing is sent anywhere.
 *  Pip praises the habit (logging, consistency, protein targets the user set), never eating less or weighing less. */
export type MascotMood = 'wave' | 'happy' | 'proud' | 'cheer' | 'calm' | 'sleepy' | 'uneasy'
export type MascotAction = 'log' | 'copy-yesterday'

export interface MascotLine {
  /** Stable for one situation on one day, so a dismissed line stays dismissed until something new happens. */
  id: string
  mood: MascotMood
  text: string
  action?: MascotAction
  /** The meal a "log" action should open, picked from the time of day. */
  meal?: MealCategory
}

export interface MascotContext {
  /** The day being viewed. Pip only speaks about today. */
  date: string
  today: string
  /** Local hour, 0 to 23. */
  hour: number
  entries: DiaryEntry[]
  weights: WeightEntry[]
  goals?: Goals
  /** Reflux watch is on: Pip points out common heartburn triggers eaten today. */
  reflux?: boolean
}

/** Missing means on: the user turns Pip off by storing `mascot: false`. */
/** Missing means off: reflux watch is opt-in. */
export const isRefluxWatchOn = (preferences: Preferences | undefined): boolean => preferences?.refluxWatch === true

export const isMascotOn = (preferences: Preferences | undefined): boolean => preferences?.mascot !== false

export const mealForHour = (hour: number): MealCategory => {
  if (hour >= 4 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 15 && hour < 17) return 'snack'
  return 'dinner'
}

const isNight = (hour: number) => hour >= 22 || hour < 4

/** Small deterministic hash so the same situation on the same day always gets the same wording. */
const pick = <T,>(options: readonly T[], seed: string): T => {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0
  return options[Math.abs(hash) % options.length]
}

/** Consecutive days with at least one eaten entry, counting back from `today`. */
export const loggingStreak = (entries: DiaryEntry[], today: string): number => {
  const days = new Set(entries.filter((entry) => !entry.planned).map((entry) => entry.date))
  let streak = 0
  let day = today
  while (days.has(day)) {
    streak += 1
    day = shiftDate(day, -1)
  }
  return streak
}

export const pickMascotLine = ({ date, today, hour, entries, weights, goals, reflux }: MascotContext): MascotLine | null => {
  if (date !== today) return null
  const eaten = entries.filter((entry) => !entry.planned)
  const todays = eaten.filter((entry) => entry.date === today)
  const seed = (id: string) => `${today}:${id}`
  const line = (id: string, mood: MascotMood, options: readonly string[], extra: Partial<MascotLine> = {}): MascotLine => ({ id, mood, text: pick(options, seed(id)), ...extra })
  const meal = mealForHour(hour)

  if (todays.length === 0) {
    const earlier = eaten.filter((entry) => entry.date < today).reduce<string | undefined>((latest, entry) => (!latest || entry.date > latest ? entry.date : latest), undefined)
    if (earlier && earlier < shiftDate(today, -2)) {
      return line('welcome-back', 'wave', ['Welcome back! No catching up needed. Just log what comes next.', 'Good to see you again. Today is a fresh page.'], { action: 'log', meal })
    }
    if (earlier === shiftDate(today, -1)) {
      return line('copy-yesterday', 'happy', ['Yesterday is all logged. Eating the same today? Copy it in one tap.', 'Same routine as yesterday? I can copy it over for you.'], { action: 'copy-yesterday' })
    }
    if (isNight(hour)) return line('night-empty', 'sleepy', ['Quiet day on the log. Even one entry keeps the picture honest.'], { action: 'log', meal })
    const greeting = meal === 'breakfast'
      ? ['Good morning! What’s for breakfast?', 'Morning! Start with breakfast and the day takes care of itself.']
      : meal === 'lunch'
        ? ['Hi there! Lunch is a great place to start.', 'Hey! What’s on the plate for lunch?']
        : meal === 'snack'
          ? ['Afternoon! A snack counts too.', 'Hey! Log a snack or catch up on lunch.']
          : ['Evening! Log dinner and you’re all set.', 'Hi! Dinner time is a good time to catch up.']
    return line(`hello-${meal}`, 'wave', greeting, { action: 'log', meal })
  }

  const growth = pipGrowth(entries, today)
  if (growth.grewToday) {
    const grew: Record<number, string[]> = {
      1: ['I’m a seedling now! Three days logged. Thank you!', 'New leaves! Three logged days made me a seedling.'],
      2: ['Look, a bud! A whole week of logged days.', 'Seven logged days, and I’m budding!'],
      3: ['I bloomed! Two weeks of logged days.', 'Fourteen logged days. Look at my flower!'],
      4: ['Thirty logged days. I’m flourishing!', 'Fully grown at thirty days. What a garden you keep.'],
    }
    return line(`grew-${growth.stage}`, 'cheer', grew[growth.stage])
  }
  if (reflux) {
    const day = refluxDay(entries, today)
    if (day.level > 0) {
      const list = listTriggers(day.triggers)
      const id = `reflux-${day.level}-${day.triggers.join('+')}${day.lateMeal ? '-late' : ''}`
      const late = day.lateMeal ? ' Late, heavy meal too, so stay upright a while.' : ''
      if (day.triggers.length === 0) return line(id, 'uneasy', ['Late, heavy meal. That’s a common reflux trigger, so stay upright a while.'])
      if (day.level === 2) return line(id, 'uneasy', [`Tummy’s grumbling: ${list} today. Common reflux triggers, so go gentle.${late}`])
      return line(id, 'uneasy', [`Heads up: ${list} ${day.triggers.length === 1 ? 'is a common reflux trigger' : 'are common reflux triggers'}.${late}`])
    }
  }
  const totalProtein = todays.reduce((sum, entry) => sum + entry.protein, 0)
  if (goals?.protein && goals.protein > 0 && totalProtein >= goals.protein) {
    return line('protein', 'proud', ['Protein target reached. Nicely done!', 'That’s your protein target hit for today.'])
  }
  const meals = new Set(todays.map((entry) => entry.meal))
  if (meals.has('breakfast') && meals.has('lunch') && meals.has('dinner')) {
    return line('all-meals', 'proud', ['Breakfast, lunch and dinner all logged. That’s the full picture.', 'Three meals logged. Your trends love days like this.'])
  }
  const streak = loggingStreak(eaten, today)
  if (streak >= 3 && todays.length <= 2) {
    return line(`streak-${streak}`, 'cheer', [`${streak} days logged in a row. Steady beats perfect.`, `That’s ${streak} days in a row. The habit is forming.`])
  }
  if (todays.length === 1) {
    return line('first', 'happy', ['First one’s in. Great start!', 'Logged! The first entry is the hardest one.'])
  }
  if (weights.some((weight) => weight.date === today)) {
    return line('weighed', 'calm', ['Weigh-in saved. The trend cares about the week, not one morning.'])
  }
  const totalCalories = todays.reduce((sum, entry) => sum + entry.calories, 0)
  if (goals?.calories && goals.calories > 0 && totalCalories > goals.calories) {
    return line('honest', 'calm', ['Logging the big days too. That’s what makes your numbers trustworthy.', 'Every day counts, the big ones included. Thanks for logging it.'])
  }
  if (isNight(hour)) return line('night', 'sleepy', ['Nice logging today. See you tomorrow!'])
  return line(`count-${todays.length}`, 'happy', [`${todays.length} foods logged today. You’re keeping a clear record.`, `${todays.length} entries in. Keep it rolling.`])
}

/** What Pip does in the moment: eating a fresh entry, or reacting to pokes and pets. Shown for a second or two over the usual line. */
export type MascotReaction = 'eating' | 'dizzy' | 'giggle' | 'loved'

/** A food name short enough for a bubble: the first part of a USDA name ("Chicken, breast, ...") or the first four words. */
export const shortFoodName = (name: string): string => {
  const first = name.split(',')[0].trim()
  const words = first.split(/\s+/).slice(0, 4).join(' ')
  const short = words.length > 28 ? `${words.slice(0, 27).trimEnd()}…` : words
  return short.charAt(0).toLowerCase() + short.slice(1)
}

/** Pip eats what you log. The id of the entry seeds the wording so the same entry always gets the same line. */
export const feedLine = (name: string, seed: string): string => {
  const food = shortFoodName(name)
  return pick([`Nom! ${food}, logged.`, `Mmm, ${food}. Thank you!`, `Ooh, ${food}! In it goes.`, `${food.charAt(0).toUpperCase()}${food.slice(1)}? Nom nom.`, `Yum. ${food} is on the record.`], seed)
}

/** Pip is ticklish. The line depends on how many quick pokes in a row. */
export const pokeLine = (count: number): { reaction: MascotReaction | null; text: string | null } => {
  if (count >= 8) return { reaction: 'giggle', text: 'Okay, okay! I’m very ticklish.' }
  if (count >= 5) return { reaction: 'giggle', text: 'Hehe, stop it! That tickles.' }
  if (count >= 3) return { reaction: 'dizzy', text: 'Whoa. Dizzy.' }
  return { reaction: null, text: null }
}

/** A long press is a pat on the head. */
export const petLine = (seed: string): string => pick(['Pats! Best part of my day.', 'Aw. Thank you.', 'I could stay like this all day.'], seed)
