// Backup format 2 adds water and body measurements. Version 1 files upgrade with none; a newer file is refused.
import { describe, expect, it } from 'vitest'
import { BACKUP_VERSION, readBackup, validateBackup } from './backup'

const stamp = '2026-01-01T00:00:00.000Z'
const base = (): Record<string, unknown> => ({
  format: 'nutrienttrack-backup', version: 2, exportedAt: stamp, entries: [], foods: [], weights: [], settings: [], water: [], measurements: [],
})
const withWater = (item: unknown) => ({ ...base(), water: [item] })
const withMeasurement = (item: unknown) => ({ ...base(), measurements: [item] })
const goodWater = { id: '2026-03-01', date: '2026-03-01', ml: 237, createdAt: stamp, updatedAt: stamp }
const goodMeasurement = { id: '2026-03-01', date: '2026-03-01', unit: 'in', waist: 34.5, createdAt: stamp, updatedAt: stamp }

describe('readBackup', () => {
  it('upgrades a version 1 object to version 2 with empty water and measurements', () => {
    const v1: Record<string, unknown> = { ...base(), version: 1 }
    delete v1.water
    delete v1.measurements
    const result = readBackup(v1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.version).toBe(BACKUP_VERSION)
    expect(result.backup.water).toEqual([])
    expect(result.backup.measurements).toEqual([])
  })

  it('does not mutate the version 1 object it was given', () => {
    const v1 = { ...base(), version: 1 }
    readBackup(v1)
    expect(v1.version).toBe(1)
  })

  it('refuses version 3 as newer', () => {
    expect(readBackup({ ...base(), version: 3 })).toEqual({ ok: false, reason: 'newer' })
  })

  it('treats a version 2 object with no water array as invalid', () => {
    const v2 = base()
    delete v2.water
    expect(readBackup(v2)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('treats a version 2 object with no measurements array as invalid', () => {
    const v2 = base()
    delete v2.measurements
    expect(readBackup(v2)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('keeps unknown fields on water and measurement rows', () => {
    const result = readBackup({ ...base(), water: [{ ...goodWater, future: 1 }], measurements: [{ ...goodMeasurement, future: 2 }] })
    if (!result.ok) throw new Error('rejected')
    expect(result.backup.water[0]).toMatchObject({ future: 1 })
    expect(result.backup.measurements[0]).toMatchObject({ future: 2 })
  })
})

describe('validateBackup: water', () => {
  it('accepts a good row and zero millilitres', () => {
    expect(validateBackup(withWater(goodWater))).toBe(true)
    expect(validateBackup(withWater({ ...goodWater, ml: 0 }))).toBe(true)
  })
  it('rejects negative ml', () => expect(validateBackup(withWater({ ...goodWater, ml: -1 }))).toBe(false))
  it('rejects string ml', () => expect(validateBackup(withWater({ ...goodWater, ml: '237' }))).toBe(false))
  it('rejects NaN ml', () => expect(validateBackup(withWater({ ...goodWater, ml: Number.NaN }))).toBe(false))
  it.each([['03/01/2026'], ['2026-3-1'], ['2026-02-30'], ['']])('rejects the date %s', (date) => {
    expect(validateBackup(withWater({ ...goodWater, date }))).toBe(false)
  })
  it('rejects duplicate ids', () => expect(validateBackup({ ...base(), water: [goodWater, goodWater] })).toBe(false))
  it('rejects a row with no id', () => {
    const { id: _id, ...noId } = goodWater
    expect(validateBackup(withWater(noId))).toBe(false)
  })
})

describe('validateBackup: measurements', () => {
  it('accepts a row with only some parts', () => {
    expect(validateBackup(withMeasurement(goodMeasurement))).toBe(true)
    expect(validateBackup(withMeasurement({ ...goodMeasurement, waist: undefined, thigh: 22 }))).toBe(true)
  })
  it('accepts a row with no parts at all', () => {
    const { waist: _waist, ...none } = goodMeasurement
    expect(validateBackup(withMeasurement(none))).toBe(true)
  })
  it('accepts cm', () => expect(validateBackup(withMeasurement({ ...goodMeasurement, unit: 'cm' }))).toBe(true))
  it.each([['mm'], ['ft'], ['']])('rejects the unit %s', (unit) => {
    expect(validateBackup(withMeasurement({ ...goodMeasurement, unit }))).toBe(false)
  })
  it.each([[0], [-3], ['x'], ['34'], [Number.NaN]])('rejects waist %s', (waist) => {
    expect(validateBackup(withMeasurement({ ...goodMeasurement, waist }))).toBe(false)
  })
  it.each([['hips'], ['chest'], ['arm'], ['thigh']])('rejects a zero %s', (part) => {
    expect(validateBackup(withMeasurement({ ...goodMeasurement, [part]: 0 }))).toBe(false)
  })
  it('rejects a non-ISO date', () => expect(validateBackup(withMeasurement({ ...goodMeasurement, date: 'yesterday' }))).toBe(false))
  it('rejects duplicate ids', () => expect(validateBackup({ ...base(), measurements: [goodMeasurement, goodMeasurement] })).toBe(false))
})
