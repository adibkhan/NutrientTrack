import { useState, type FormEvent } from 'react'
import type { DiaryEntry, MealCategory } from '../types'
import { formatShortDate } from '../lib/utils'
import { Icon } from './Icon'
import { Modal } from './Modal'

const MEALS: Array<{ key: MealCategory; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
  { key: 'other', label: 'Other' },
]

interface CopyModalProps {
  /** One entry to copy; when absent the whole viewed day is copied. */
  entry?: DiaryEntry
  /** The day being viewed, which a day copy takes its foods from. */
  sourceDate: string
  /** A sensible first choice for the target date. */
  defaultDate: string
  /** How many eaten foods a day copy would copy. */
  dayCount: number
  onClose: () => void
  onCopyEntry: (entry: DiaryEntry, meal: MealCategory, date: string, time: string) => Promise<void>
  onCopyDay: (date: string) => Promise<void>
}

export function CopyModal({ entry, sourceDate, defaultDate, dayCount, onClose, onCopyEntry, onCopyDay }: CopyModalProps) {
  const [date, setDate] = useState(defaultDate)
  const [meal, setMeal] = useState<MealCategory>(entry?.meal ?? 'other')
  const [time, setTime] = useState(entry?.time ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!date) { setError('Choose a date.'); return }
    if (!entry && date === sourceDate) { setError('Choose a different day to copy to.'); return }
    setError('')
    setSaving(true)
    try {
      if (entry) await onCopyEntry(entry, meal, date, time)
      else await onCopyDay(date)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal eyebrow="Copy" title={entry ? `Copy ${entry.name}` : `Copy ${formatShortDate(sourceDate)} to another day`} onClose={onClose} closeOnBackdrop={false}>
      <form className="modal-form move-form" onSubmit={submit}>
        {!entry && <p className="move-note"><Icon name="info" size={14} />{dayCount === 1 ? '1 eaten food' : `${dayCount} eaten foods`} will be copied. Planned foods stay behind.</p>}
        <div className="form-field full">
          <label htmlFor="copy-date">Copy to date</label>
          <input autoFocus id="copy-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {entry && (
          <div className="logger-meta-grid">
            <div className="form-field">
              <label htmlFor="copy-meal">Meal</label>
              <select id="copy-meal" value={meal} onChange={(event) => setMeal(event.target.value as MealCategory)}>{MEALS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
            </div>
            <div className="form-field">
              <label htmlFor="copy-time">Time <span>optional</span></label>
              <input id="copy-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </div>
          </div>
        )}
        {error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={saving || (!entry && dayCount === 0)} type="submit"><Icon name="check" size={16} />{saving ? 'Copying…' : 'Copy'}</button>
        </div>
      </form>
    </Modal>
  )
}
