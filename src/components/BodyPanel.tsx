import { useState } from 'react'
import type { BodyMeasurement } from '../types'
import { measurementRows, MEASUREMENTS } from '../lib/measurements'
import { formatNumber, formatShortDate } from '../lib/utils'
import { Icon } from './Icon'

interface BodyPanelProps {
  measurements: BodyMeasurement[]
  unit: 'in' | 'cm'
  onAdd: () => void
  onEdit: (measurement: BodyMeasurement) => void
  onDelete: (measurement: BodyMeasurement) => void
}

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), 1)}`

/** How many dated check-ins the history lists before "Show all". */
const HISTORY_PREVIEW = 3

export function BodyPanel({ measurements, unit, onAdd, onEdit, onDelete }: BodyPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const rows = measurementRows(measurements, unit)
  const newestFirst = measurements.slice().sort((a, b) => b.date.localeCompare(a.date))
  const visible = showAll ? newestFirst : newestFirst.slice(0, HISTORY_PREVIEW)
  return (
    <section className="panel body-panel" aria-labelledby="body-heading">
      <div className="panel-header"><div><h2 id="body-heading">Body measurements</h2></div><button className="button primary compact" type="button" onClick={onAdd}><Icon name="plus" size={17} />Log measurements</button></div>
      {rows.length === 0 ? (
        <p className="muted-footnote">Log a waist, hips, chest, arm or thigh measurement to see how each one changes over time.</p>
      ) : (
        <div className="stat-list">
          <div className="stat-row stat-head"><span>Measurement</span><span>Latest</span><span>30 days</span></div>
          {rows.map((row) => (
            <div className="stat-row measurement-row" key={row.key}>
              <span>{row.label}</span>
              <strong>{formatNumber(row.latest, 1)} {unit}</strong>
              <span className="change">{row.change === undefined ? '—' : `${signed(row.change)} ${unit}`}</span>
            </div>
          ))}
        </div>
      )}
      {newestFirst.length > 0 && (
        <div className="measurement-history">
          <p className="logger-section-title"><span>Check-ins</span><small>{newestFirst.length} {newestFirst.length === 1 ? 'entry' : 'entries'}</small></p>
          {visible.map((record) => (
            <div className="tool-row" key={record.id}>
              <div>
                <strong>{formatShortDate(record.date)}</strong>
                <p>{MEASUREMENTS.filter(({ key }) => record[key] !== undefined).map(({ key, label }) => `${label} ${formatNumber(record[key] ?? 0, 1)}`).join(' · ') || 'No values'} {record.unit}</p>
              </div>
              <div className="row-actions">
                <button className="icon-button quiet" type="button" aria-label={`Edit measurements from ${formatShortDate(record.date)}`} onClick={() => onEdit(record)}><Icon name="edit" size={16} /></button>
                <button className="icon-button quiet danger-hover" type="button" aria-label={`Delete measurements from ${formatShortDate(record.date)}`} onClick={() => onDelete(record)}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          ))}
          {newestFirst.length > HISTORY_PREVIEW && <button className="text-button" type="button" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>{showAll ? 'Show fewer' : `Show all ${newestFirst.length}`}</button>}
        </div>
      )}
    </section>
  )
}
