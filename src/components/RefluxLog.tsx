import { useState } from 'react'
import type { Symptom } from '../types'
import { formatClockTime } from '../lib/utils'
import { Icon } from './Icon'

export const SEVERITY_LABELS: Record<Symptom['severity'], string> = { 1: 'Mild', 2: 'Moderate', 3: 'Severe' }

interface RefluxLogProps {
  /** Flares on the day being shown. */
  symptoms: Symptom[]
  onLog: (severity: Symptom['severity']) => void
  onDelete: (symptom: Symptom) => void
}

/**
 * One row under the water line, shown only with reflux watch on: tap "Heartburn", pick how bad, done. Each flare is a
 * chip that can be removed again. The flares feed the trigger finder on Trends, and never leave the device.
 */
export function RefluxLog({ symptoms, onLog, onDelete }: RefluxLogProps) {
  const [choosing, setChoosing] = useState(false)
  const pick = (severity: Symptom['severity']) => {
    onLog(severity)
    setChoosing(false)
  }
  return (
    <div className="reflux-row" aria-label="Heartburn log">
      <span className="water-label">Heartburn</span>
      <div className="reflux-flares">
        {symptoms.length === 0 && !choosing && <span className="reflux-none">None today</span>}
        {symptoms.map((symptom) => (
          <span className={`reflux-chip severity-${symptom.severity}`} key={symptom.id}>
            {SEVERITY_LABELS[symptom.severity]}{symptom.time && <small> {formatClockTime(symptom.time)}</small>}
            <button className="reflux-chip-remove" type="button" aria-label={`Remove ${SEVERITY_LABELS[symptom.severity].toLowerCase()} heartburn${symptom.time ? ` at ${formatClockTime(symptom.time)}` : ''}`} onClick={() => onDelete(symptom)}><Icon name="x" size={12} /></button>
          </span>
        ))}
      </div>
      {choosing ? (
        <div className="reflux-choices" role="group" aria-label="How bad is it?">
          {([1, 2, 3] as const).map((severity) => <button className={`reflux-choice severity-${severity}`} type="button" key={severity} onClick={() => pick(severity)}>{SEVERITY_LABELS[severity]}</button>)}
          <button className="icon-button quiet" type="button" aria-label="Cancel" onClick={() => setChoosing(false)}><Icon name="x" size={14} /></button>
        </div>
      ) : (
        <button className="button secondary compact" type="button" onClick={() => setChoosing(true)}><Icon name="plus" size={15} />Log heartburn</button>
      )}
    </div>
  )
}
