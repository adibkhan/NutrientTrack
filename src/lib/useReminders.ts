import { useEffect, useRef } from 'react'
import { dueReminders, markFired, notificationsSupported, readReminders, REMINDERS, wasFired, type ReminderContext } from './reminders'
import { todayISO } from './utils'

/**
 * Show the reminders the person asked for. This only works while the app is open: a browser cannot wake a closed
 * page without a push server, and this app has none. Nothing is sent anywhere.
 */
/**
 * Show one reminder. Android Chrome only allows notifications through a service worker registration, so that is tried
 * first; the plain constructor covers desktop browsers. Resolves true only when a notification was actually shown.
 */
const showReminder = async (reminder: { kind: string; title: string; body: string }): Promise<boolean> => {
  const options = { body: reminder.body, tag: `nutrienttrack-${reminder.kind}` }
  try {
    const registration = typeof navigator !== 'undefined' && navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : undefined
    if (registration?.showNotification) {
      await registration.showNotification(reminder.title, options)
      return true
    }
  } catch {
    // Fall through to the constructor.
  }
  try {
    new Notification(reminder.title, options)
    return true
  } catch {
    return false
  }
}

export const useReminders = (rawTimes: unknown, context: ReminderContext, enabled: boolean): void => {
  const inFlight = useRef(new Set<string>())
  const contextRef = useRef(context)
  contextRef.current = context
  const times = readReminders(rawTimes)
  const timesKey = JSON.stringify(times)

  useEffect(() => {
    if (!enabled || !notificationsSupported() || Notification.permission !== 'granted' || Object.keys(times).length === 0) return undefined
    const check = () => {
      const today = todayISO()
      for (const kind of dueReminders(times, new Date(), (item) => wasFired(item, today), contextRef.current)) {
        const reminder = REMINDERS.find((item) => item.kind === kind)
        if (!reminder || inFlight.current.has(kind)) continue
        inFlight.current.add(kind)
        // Marked as fired only once it was shown, so a browser that refuses is tried again at the next check instead of losing the day's reminder.
        void showReminder(reminder).then((shown) => {
          if (shown) markFired(kind, today)
        }).finally(() => { inFlight.current.delete(kind) })
      }
    }
    check()
    const timer = window.setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
    // times is derived from timesKey, so the effect restarts only when the chosen times change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timesKey])
}
