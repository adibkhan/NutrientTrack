import { useState, type FormEvent } from 'react'
import type { BodyMeasurement } from '../types'
import { emptyMeasurementDraft, measurementDraftFrom, MEASUREMENTS, measurementValuesFrom, type MeasurementDraft, type MeasurementKey } from '../lib/measurements'
import { Icon } from './Icon'
import { Modal } from './Modal'

export interface MeasurementsSubmit {
  date: string
  unit: 'in' | 'cm'
  values: Partial<Record<MeasurementKey, number>>
}

interface MeasurementsModalProps {
  measurement?: BodyMeasurement
  defaultDate: string
  unit: 'in' | 'cm'
  onClose: () => void
  onSave: (submit: MeasurementsSubmit, existing?: BodyMeasurement) => Promise<void>
}

export function MeasurementsModal({ measurement, defaultDate, unit, onClose, onSave }: MeasurementsModalProps) {
  const [date, setDate] = useState(measurement?.date ?? defaultDate)
  const [draft, setDraft] = useState<MeasurementDraft>(() => (measurement ? measurementDraftFrom(measurement, unit) : emptyMeasurementDraft()))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!date) { setError('Choose a date.'); return }
    const bad = MEASUREMENTS.find(({ key }) => draft[key].trim() && !(Number(draft[key]) > 0 && Number.isFinite(Number(draft[key]))))
    if (bad) { setError(`${bad.label} must be a number greater than zero.`); return }
    const values = measurementValuesFrom(draft)
    if (Object.keys(values).length === 0) { setError('Enter at least one measurement.'); return }
    setError('')
    setSaving(true)
    try { await onSave({ date, unit, values }, measurement) } finally { setSaving(false) }
  }

  return (
    <Modal eyebrow={measurement ? 'Edit check-in' : 'New check-in'} title="Log measurements" onClose={onClose} closeOnBackdrop={false}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-field full">
          <label htmlFor="measure-date">Date</label>
          <input id="measure-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="nutrient-grid flush">
          {MEASUREMENTS.map(({ key, label }) => (
            <div className="form-field" key={key}>
              <label htmlFor={`measure-${key}`}>{label} <span>{unit}</span></label>
              <input autoFocus={key === 'waist'} id={`measure-${key}`} inputMode="decimal" min="0" placeholder="Not measured" step="any" type="number" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
            </div>
          ))}
        </div>
        <p className="move-note"><Icon name="info" size={14} />Saving a second check-in for the same day replaces the first.</p>
        {error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={saving} type="submit"><Icon name="check" size={16} />{saving ? 'Saving…' : 'Save check-in'}</button>
        </div>
      </form>
    </Modal>
  )
}
