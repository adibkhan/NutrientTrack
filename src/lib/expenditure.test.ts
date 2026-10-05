import { describe, expect, it } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import { estimateExpenditure } from './expenditure'
import { LB_PER_KG } from './trend'
import { shiftDate } from './utils'

const END = '2026-03-15'
const stamp = '2026-01-01T00:00:00.000Z'
const day = (offset: number) => shiftDate(END, -offset)

let seq = 0
const eaten = (date: string, calories: number, extra: Partial<DiaryEntry> = {}): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp, ...extra })
const weigh = (date: string, weight: number, unit: 'lb' | 'kg' = 'lb'): WeightEntry => ({ id: `w-${date}`, date, weight, unit, createdAt: stamp })

/** One entry a day for `days` days ending on END. */
const intake = (days: number, calories: number) => Array.from({ length: days }, (_, i) => eaten(day(i), calories))
/** Flat weigh-ins on the given day offsets before END. */
const flat = (offsets: number[], weight = 180, unit: 'lb' | 'kg' = 'lb') => offsets.map((o) => weigh(day(o), weight, unit))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('estimateExpenditure: not enough data', () => {
  it('is insufficient with an empty diary and no weights', () => {
    const r = estimateExpenditure([], [], END)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') {
      expect(r.loggedDays).toBe(0)
      expect(r.weighIns).toBe(0)
      expect(r.reason).toMatch(/at least 14/)
    }
  })

  it('is insufficient with 13 logged days and reports the count', () => {
    const r = estimateExpenditure(intake(13, 2000), flat([14, 10, 5, 0]), END)
    expect(r).toMatchObject({ kind: 'insufficient', loggedDays: 13, weighIns: 4 })
    if (r.kind === 'insufficient') expect(r.reason).toMatch(/You have 13/)
  })

  it('is insufficient with 3 weigh-ins', () => {
    const r = estimateExpenditure(intake(20, 2000), flat([14, 7, 0]), END)
    expect(r).toMatchObject({ kind: 'insufficient', loggedDays: 20, weighIns: 3 })
    if (r.kind === 'insufficient') expect(r.reason).toMatch(/weight at least 4 times/)
  })

  it('is insufficient when weigh-ins span 13 days', () => {
    const r = estimateExpenditure(intake(20, 2000), flat([13, 9, 4, 0]), END)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.reason).toMatch(/span at least 14 days. They span 13/)
  })

  it('does not count planned entries as logged days', () => {
    const entries = [...intake(13, 2000), eaten(day(20), 2000, { planned: true })]
    const r = estimateExpenditure(entries, flat([14, 10, 5, 0]), END)
    expect(r).toMatchObject({ kind: 'insufficient', loggedDays: 13 })
  })

  it('ignores entries outside the 28-day window', () => {
    const entries = [...intake(13, 2000), eaten(day(28), 2000), eaten(day(40), 2000), eaten(shiftDate(END, 1), 2000)]
    const r = estimateExpenditure(entries, flat([14, 10, 5, 0]), END)
    expect(r).toMatchObject({ kind: 'insufficient', loggedDays: 13 })
  })

  it('ignores weigh-ins outside the window', () => {
    const r = estimateExpenditure(intake(20, 2000), flat([60, 50, 40, 30, 0]), END)
    expect(r).toMatchObject({ kind: 'insufficient', weighIns: 1 })
  })

  it('ignores entries with a non-finite calorie value', () => {
    const entries = [...intake(13, 2000), eaten(day(15), Number.NaN)]
    expect(estimateExpenditure(entries, flat([14, 10, 5, 0]), END)).toMatchObject({ kind: 'insufficient', loggedDays: 13 })
  })
})

describe('estimateExpenditure: estimates', () => {
  it('accepts exactly 14 logged days and 4 weigh-ins spanning exactly 14 days', () => {
    const r = estimateExpenditure(intake(14, 2000), flat([14, 9, 4, 0]), END)
    expect(r).toMatchObject({ kind: 'ok', loggedDays: 14, weighIns: 4, spanDays: 14, kcalPerDay: 2000 })
  })

  it('gives expenditure equal to intake when weight is steady', () => {
    const r = estimateExpenditure(intake(20, 2300), flat([20, 15, 10, 5, 0]), END)
    expect(r).toMatchObject({ kind: 'ok', kcalPerDay: 2300, avgIntake: 2300, impliedBalance: 0 })
  })

  it('does not count a day with no entries as zero intake', () => {
    // 14 logged days out of 28: the average must stay 2000, not 1000.
    const r = estimateExpenditure(intake(14, 2000), flat([14, 9, 4, 0]), END)
    expect(r.kind === 'ok' && r.avgIntake).toBe(2000)
  })

  it('sums several entries on one day before averaging', () => {
    const entries = intake(14, 1000).flatMap((e) => [e, eaten(e.date, 1000)])
    const r = estimateExpenditure(entries, flat([14, 9, 4, 0]), END)
    expect(r.kind === 'ok' && r.avgIntake).toBe(2000)
  })

  it('leaves planned entries out of the intake', () => {
    const entries = [...intake(14, 2000), ...range(0, 13).map((o) => eaten(day(o), 5000, { planned: true }))]
    const r = estimateExpenditure(entries, flat([14, 9, 4, 0]), END)
    expect(r.kind === 'ok' && r.avgIntake).toBe(2000)
  })

  it('reads a loss of about 1 lb a week as intake plus 500', () => {
    // Daily weigh-ins for 90 days so the trend has settled before the window starts.
    const weights = range(0, 89).map((o) => weigh(day(o), 180 + o / 7))
    const r = estimateExpenditure(intake(28, 2000), weights, END)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.trendChangeLb).toBeLessThan(0)
      expect(r.kcalPerDay).toBeGreaterThan(2490)
      expect(r.kcalPerDay).toBeLessThan(2520)
      expect(r.impliedBalance).toBeLessThan(0)
    }
  })

  it('reads a gain of about 1 lb a week as intake minus 500', () => {
    const weights = range(0, 89).map((o) => weigh(day(o), 180 - o / 7))
    const r = estimateExpenditure(intake(28, 3000), weights, END)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.kcalPerDay).toBeGreaterThan(2480)
      expect(r.kcalPerDay).toBeLessThan(2510)
    }
  })

  it('gives the same answer for weights logged in kg', () => {
    const lb = estimateExpenditure(intake(20, 2300), flat([20, 15, 10, 5, 0], 180, 'lb'), END)
    const kg = estimateExpenditure(intake(20, 2300), flat([20, 15, 10, 5, 0], 180 / LB_PER_KG, 'kg'), END)
    expect(kg).toEqual(lb)
  })

  it('handles a mix of kg and lb weigh-ins', () => {
    const weights = [weigh(day(20), 180), weigh(day(15), 180 / LB_PER_KG, 'kg'), weigh(day(10), 180), weigh(day(0), 180 / LB_PER_KG, 'kg')]
    const r = estimateExpenditure(intake(20, 2300), weights, END)
    expect(r).toMatchObject({ kind: 'ok', kcalPerDay: 2300 })
  })
})

describe('estimateExpenditure: believability limits', () => {
  it('rejects a result below 800 kcal', () => {
    const r = estimateExpenditure(intake(20, 500), flat([20, 15, 10, 5, 0]), END)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.reason).toMatch(/believable/)
  })

  it('rejects a result above 6000 kcal', () => {
    expect(estimateExpenditure(intake(20, 7000), flat([20, 15, 10, 5, 0]), END).kind).toBe('insufficient')
  })

  it('accepts exactly 800 and exactly 6000', () => {
    expect(estimateExpenditure(intake(20, 800), flat([20, 15, 10, 5, 0]), END)).toMatchObject({ kind: 'ok', kcalPerDay: 800 })
    expect(estimateExpenditure(intake(20, 6000), flat([20, 15, 10, 5, 0]), END)).toMatchObject({ kind: 'ok', kcalPerDay: 6000 })
  })

  it('rejects a mistyped weight that implies an impossible burn', () => {
    const weights = [weigh(day(20), 180), weigh(day(15), 180), weigh(day(10), 180), weigh(day(0), 1800)]
    expect(estimateExpenditure(intake(20, 2000), weights, END).kind).toBe('insufficient')
  })
})

describe('estimateExpenditure: confidence', () => {
  it('is low at the minimum data', () => {
    const r = estimateExpenditure(intake(14, 2000), flat([14, 9, 4, 0]), END)
    expect(r.kind === 'ok' && r.confidence).toBe('low')
  })

  it('is medium with 17 logged days and 5 weigh-ins', () => {
    const r = estimateExpenditure(intake(17, 2000), flat([20, 15, 10, 5, 0]), END)
    expect(r.kind === 'ok' && r.confidence).toBe('medium')
  })

  it('stays low with many days but only 4 weigh-ins', () => {
    const r = estimateExpenditure(intake(28, 2000), flat([20, 15, 10, 0]), END)
    expect(r.kind === 'ok' && r.confidence).toBe('low')
  })

  it('is high with 24 logged days and 8 weigh-ins', () => {
    const r = estimateExpenditure(intake(24, 2000), flat([26, 22, 18, 14, 10, 6, 3, 0]), END)
    expect(r.kind === 'ok' && r.confidence).toBe('high')
  })

  it('is medium just under the high coverage line (23 of 28 days)', () => {
    const r = estimateExpenditure(intake(23, 2000), flat([26, 22, 18, 14, 10, 6, 3, 0]), END)
    expect(r.kind === 'ok' && r.confidence).toBe('medium')
  })
})
