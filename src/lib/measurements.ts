import type { BodyMeasurement } from '../types'
import { dateFromISO, shiftDate } from './utils'

export const MEASUREMENTS = [
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'chest', label: 'Chest' },
  { key: 'arm', label: 'Arm' },
  { key: 'thigh', label: 'Thigh' },
] as const

export type MeasurementKey = (typeof MEASUREMENTS)[number]['key']
export type MeasurementDraft = Record<MeasurementKey, string>

export const CM_PER_INCH = 2.54

export const measurementUnitFor = (weightUnit: 'lb' | 'kg'): 'in' | 'cm' => (weightUnit === 'kg' ? 'cm' : 'in')

export const convertLength = (value: number, from: 'in' | 'cm', to: 'in' | 'cm'): number => {
  if (from === to) return value
  return from === 'in' ? value * CM_PER_INCH : value / CM_PER_INCH
}

export const emptyMeasurementDraft = (): MeasurementDraft => ({ waist: '', hips: '', chest: '', arm: '', thigh: '' })

export const measurementDraftFrom = (record: BodyMeasurement | undefined, unit: 'in' | 'cm'): MeasurementDraft => {
  const draft = emptyMeasurementDraft()
  if (!record) return draft
  for (const { key } of MEASUREMENTS) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) draft[key] = String(Math.round(convertLength(value, record.unit, unit) * 10) / 10)
  }
  return draft
}

/** The valid values in a draft, in `unit`. Empty boxes are left out so they stay "not measured". */
export const measurementValuesFrom = (draft: MeasurementDraft): Partial<Record<MeasurementKey, number>> => {
  const values: Partial<Record<MeasurementKey, number>> = {}
  for (const { key } of MEASUREMENTS) {
    const text = draft[key].trim()
    if (!text) continue
    const parsed = Number(text)
    if (Number.isFinite(parsed) && parsed > 0) values[key] = parsed
  }
  return values
}

export interface MeasurementRow {
  key: MeasurementKey
  label: string
  latest: number
  date: string
  unit: 'in' | 'cm'
  /** Change since the earliest reading within 30 days before the latest one; undefined when there is no earlier reading in that window. */
  change?: number
}

/** One row per body part that has ever been measured: the latest reading and its 30-day change, all in `unit`. */
export const measurementRows = (records: BodyMeasurement[], unit: 'in' | 'cm'): MeasurementRow[] => {
  const rows: MeasurementRow[] = []
  for (const { key, label } of MEASUREMENTS) {
    const readings = records
      .filter((record) => typeof record[key] === 'number' && Number.isFinite(record[key]) && (record[key] as number) > 0)
      .map((record) => ({ date: record.date, value: convertLength(record[key] as number, record.unit, unit) }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const latest = readings[readings.length - 1]
    if (!latest) continue
    const windowStart = shiftDate(latest.date, -30)
    const baseline = readings.slice(0, -1).find((reading) => reading.date >= windowStart && dateFromISO(reading.date) < dateFromISO(latest.date))
    rows.push({ key, label, latest: latest.value, date: latest.date, unit, ...(baseline ? { change: latest.value - baseline.value } : {}) })
  }
  return rows
}
