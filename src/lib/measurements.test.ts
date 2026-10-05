import { describe, expect, it } from 'vitest'
import type { BodyMeasurement } from '../types'
import { convertLength, emptyMeasurementDraft, measurementDraftFrom, measurementRows, measurementUnitFor, measurementValuesFrom } from './measurements'

const stamp = '2026-01-01T00:00:00.000Z'
const rec = (date: string, unit: 'in' | 'cm', parts: Partial<Record<'waist' | 'hips' | 'chest' | 'arm' | 'thigh', number>>): BodyMeasurement => ({
  id: date, date, unit, createdAt: stamp, updatedAt: stamp, ...parts,
})

describe('measurementUnitFor', () => {
  it('uses inches for pounds and centimetres for kilograms', () => {
    expect(measurementUnitFor('lb')).toBe('in')
    expect(measurementUnitFor('kg')).toBe('cm')
  })
})

describe('convertLength', () => {
  it('returns the value unchanged for the same unit', () => {
    expect(convertLength(34.5, 'in', 'in')).toBe(34.5)
  })
  it('converts inches to centimetres', () => {
    expect(convertLength(10, 'in', 'cm')).toBeCloseTo(25.4, 10)
  })
  it('round trips through the other unit', () => {
    expect(convertLength(convertLength(34.5, 'in', 'cm'), 'cm', 'in')).toBeCloseTo(34.5, 10)
  })
})

describe('measurementDraftFrom', () => {
  it('is empty for a missing record', () => {
    expect(measurementDraftFrom(undefined, 'in')).toEqual(emptyMeasurementDraft())
  })
  it('shows stored values in the same unit', () => {
    expect(measurementDraftFrom(rec('2026-02-01', 'in', { waist: 34.5 }), 'in').waist).toBe('34.5')
  })
  it('converts the record unit to the display unit and rounds to a tenth', () => {
    expect(measurementDraftFrom(rec('2026-02-01', 'cm', { waist: 88 }), 'in').waist).toBe('34.6')
  })
  it('leaves parts that were not measured empty', () => {
    const draft = measurementDraftFrom(rec('2026-02-01', 'in', { waist: 30 }), 'in')
    expect(draft).toEqual({ ...emptyMeasurementDraft(), waist: '30' })
  })
  it('ignores zero, negative and NaN values', () => {
    const draft = measurementDraftFrom(rec('2026-02-01', 'in', { waist: 0, hips: -2, chest: Number.NaN }), 'in')
    expect(draft).toEqual(emptyMeasurementDraft())
  })
})

describe('measurementValuesFrom', () => {
  it('omits empty boxes so they stay not measured', () => {
    expect(measurementValuesFrom({ ...emptyMeasurementDraft(), waist: '34.5' })).toEqual({ waist: 34.5 })
  })
  it('omits whitespace-only boxes', () => {
    expect(measurementValuesFrom({ ...emptyMeasurementDraft(), hips: '   ' })).toEqual({})
  })
  it.each([['0'], ['-4'], ['abc'], ['Infinity']])('ignores %s', (text) => {
    expect(measurementValuesFrom({ ...emptyMeasurementDraft(), arm: text })).toEqual({})
  })
})

describe('measurementRows', () => {
  it('is empty with no records', () => {
    expect(measurementRows([], 'in')).toEqual([])
  })
  it('lists only parts that were measured, in the order of MEASUREMENTS', () => {
    const rows = measurementRows([rec('2026-03-01', 'in', { thigh: 20, waist: 34, arm: 12 })], 'in')
    expect(rows.map((row) => row.key)).toEqual(['waist', 'arm', 'thigh'])
  })
  it('has no change when there is only one reading', () => {
    const [row] = measurementRows([rec('2026-03-01', 'in', { waist: 34 })], 'in')
    expect(row).not.toHaveProperty('change')
  })
  it('takes the latest reading per part across records', () => {
    const rows = measurementRows([rec('2026-03-01', 'in', { waist: 34, hips: 40 }), rec('2026-03-10', 'in', { waist: 33.5 })], 'in')
    expect(rows.find((row) => row.key === 'waist')).toMatchObject({ latest: 33.5, date: '2026-03-10' })
    expect(rows.find((row) => row.key === 'hips')).toMatchObject({ latest: 40, date: '2026-03-01' })
  })
  it('measures change against the earliest reading within 30 days before the latest', () => {
    const rows = measurementRows([rec('2026-03-01', 'in', { waist: 35 }), rec('2026-03-15', 'in', { waist: 34.2 }), rec('2026-03-20', 'in', { waist: 34.5 })], 'in')
    expect(rows[0].change).toBeCloseTo(-0.5, 10)
  })
  it('includes a baseline exactly 30 days before the latest', () => {
    const rows = measurementRows([rec('2026-02-18', 'in', { waist: 36 }), rec('2026-03-20', 'in', { waist: 35 })], 'in')
    expect(rows[0].change).toBeCloseTo(-1, 10)
  })
  it('has no change when the only earlier reading is 31 days older', () => {
    const rows = measurementRows([rec('2026-02-17', 'in', { waist: 36 }), rec('2026-03-20', 'in', { waist: 35 })], 'in')
    expect(rows[0]).not.toHaveProperty('change')
  })
  it('has no change when two readings fall on the same date', () => {
    const a = { ...rec('2026-03-20', 'in', { waist: 36 }), id: 'a' }
    const b = { ...rec('2026-03-20', 'in', { waist: 35 }), id: 'b' }
    expect(measurementRows([a, b], 'in')[0]).not.toHaveProperty('change')
  })
  it('converts records in mixed units to the display unit', () => {
    const rows = measurementRows([rec('2026-03-01', 'cm', { waist: 88.9 }), rec('2026-03-10', 'in', { waist: 34 })], 'in')
    expect(rows[0].latest).toBe(34)
    expect(rows[0].unit).toBe('in')
    expect(rows[0].change).toBeCloseTo(-1, 6)
  })
  it('ignores zero, negative and NaN readings', () => {
    expect(measurementRows([rec('2026-03-01', 'in', { waist: 0, hips: -1, chest: Number.NaN })], 'in')).toEqual([])
  })
})
