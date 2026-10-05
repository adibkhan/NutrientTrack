import { useState } from 'react'
import { notificationsSupported, readReminders, REMINDERS, type ReminderKind, type ReminderTimes } from '../lib/reminders'

interface RemindersPanelProps {
  reminders: unknown
  onChange: (next: ReminderTimes) => void
}

export function RemindersPanel({ reminders, onChange }: RemindersPanelProps) {
  const times = readReminders(reminders)
  const supported = notificationsSupported()
  const [message, setMessage] = useState('')

  const setTime = (kind: ReminderKind, time: string | undefined) => {
    const next = { ...times }
    if (time) next[kind] = time
    else delete next[kind]
    onChange(next)
  }

  const toggle = async (kind: ReminderKind, on: boolean, fallback: string) => {
    if (!on) { setMessage(''); setTime(kind, undefined); return }
    // Asking at the moment someone turns a reminder on is the only time the browser will show its prompt.
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() } catch { permission = 'denied' }
    }
    if (permission !== 'granted') {
      setMessage('Your browser is blocking notifications for this site. Allow them in the browser settings, then try again.')
      return
    }
    setMessage('')
    setTime(kind, fallback)
  }

  return (
    <section className="panel" aria-labelledby="reminders-heading">
      <div className="panel-header"><div><h2 id="reminders-heading">Reminders</h2></div></div>
      {!supported ? (
        <p className="panel-copy">This browser does not support notifications, so reminders are not available here.</p>
      ) : (
        <>
          <div className="data-tools">
            {REMINDERS.map(({ kind, label, fallback }) => (
              <div className="tool-row reminder-row" key={kind}>
                <label className="check-inline"><input checked={times[kind] !== undefined} type="checkbox" onChange={(event) => { void toggle(kind, event.target.checked, fallback) }} /><strong>{label}</strong></label>
                <input aria-label={`${label} time`} disabled={times[kind] === undefined} required type="time" value={times[kind] ?? fallback} onChange={(event) => { if (event.target.value) setTime(kind, event.target.value) }} />
              </div>
            ))}
          </div>
          {message && <p className="form-error" role="alert">{message}</p>}
          <p className="form-note">Reminders appear while NutrientTrack is open or running in the background of your device. A browser cannot wake a closed app, and nothing is sent to a server.</p>
        </>
      )}
    </section>
  )
}
