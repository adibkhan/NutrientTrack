import { useEffect, useRef } from 'react'
import { dueReminders, markFired, notificationsSupported, readReminders, REMINDERS, wasFired, type ReminderContext } from './reminders'
import { todayISO } from './utils'

/**
 * Show the reminders the person asked for. This only works while the app is open: a browser cannot wake a closed
 * page without a push server, and this app has none. Nothing is sent anywhere.
 */
export const useReminders = (rawTimes: unknown, context: ReminderContext, enabled: boolean): void => {
  const contextRef = useRef(context)
  contextRef.current = context
  const times = readReminders(rawTimes)
  const timesKey = JSON.stringify(times)

  useEffect(() => {
    if (!enabled || !notificationsSupported() || Notification.permission !== 'granted' || Object.keys(times).length === 0) return undefined
    const check = () => {
      const today = todayISO()
      for (const kind of dueReminders(times, new Date(), (item) => wasFired(item, today), contextRef.current)) {
        markFired(kind, today)
        const reminder = REMINDERS.find((item) => item.kind === kind)
        if (!reminder) continue
        try {
          new Notification(reminder.title, { body: reminder.body, tag: `nutrienttrack-${kind}` })
        } catch {
          // Some mobile browsers only allow notifications through a service worker; the reminder is skipped, not retried.
        }
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
