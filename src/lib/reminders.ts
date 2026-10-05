import type { Preferences } from '../types'

export type ReminderKind = 'logFood' | 'weighIn'

export const REMINDERS: Array<{ kind: ReminderKind; label: string; title: string; body: string; fallback: string }> = [
  { kind: 'logFood', label: 'Log your food', title: 'Log your food', body: 'Add what you have eaten today.', fallback: '12:00' },
  { kind: 'weighIn', label: 'Weigh-in', title: 'Time to weigh in', body: 'Log your weight for today.', fallback: '07:00' },
]

export type ReminderTimes = NonNullable<Preferences['reminders']>

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Reminder times from a stored record that may come from another build: only valid "HH:MM" values for known kinds count. */
export const readReminders = (value: unknown): ReminderTimes => {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const times: ReminderTimes = {}
  for (const { kind } of REMINDERS) {
    const time = raw[kind]
    if (typeof time === 'string' && TIME.test(time)) times[kind] = time
  }
  return times
}

const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** How long after its time a reminder may still appear, so opening the app at night does not replay the morning's reminders. */
export const REMINDER_WINDOW_MINUTES = 60

export interface ReminderContext {
  /** True once food has been logged today, which makes the food reminder pointless. */
  loggedFoodToday: boolean
  /** True once weight has been logged today. */
  weighedToday: boolean
}

/** Which reminders should appear right now: their time has passed within the window, they have not fired today, and the thing they ask for is not already done. */
export const dueReminders = (
  times: ReminderTimes,
  now: Date,
  alreadyFired: (kind: ReminderKind) => boolean,
  context: ReminderContext,
): ReminderKind[] => {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return REMINDERS.filter(({ kind }) => {
    const time = times[kind]
    if (!time) return false
    const elapsed = nowMinutes - minutes(time)
    if (elapsed < 0 || elapsed > REMINDER_WINDOW_MINUTES) return false
    if (alreadyFired(kind)) return false
    if (kind === 'logFood' && context.loggedFoodToday) return false
    if (kind === 'weighIn' && context.weighedToday) return false
    return true
  }).map(({ kind }) => kind)
}

const firedKey = (kind: ReminderKind, date: string) => `nutrienttrack-reminder-${kind}-${date}`

export const wasFired = (kind: ReminderKind, date: string): boolean => {
  try {
    return localStorage.getItem(firedKey(kind, date)) !== null
  } catch {
    return false
  }
}

export const markFired = (kind: ReminderKind, date: string): void => {
  try {
    localStorage.setItem(firedKey(kind, date), '1')
  } catch {
    // Without storage a reminder may repeat on reload; that is better than missing it.
  }
}

export const notificationsSupported = (): boolean => typeof Notification !== 'undefined'
