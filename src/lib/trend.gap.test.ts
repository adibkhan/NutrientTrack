// Gap-aware trend: each reading moves the trend 1 - 0.9^days of the way toward the scale, days = max(1, calendar days since the previous reading).
import { describe, expect, it } from 'vitest'
import type { WeightEntry } from '../types'
import { LB_PER_KG, trendSeries, withTrend } from './trend'

let seq = 0
const w = (date: string, weight: number, unit: 'lb' | 'kg' = 'lb', createdAt = '2026-01-01T00:00:00.000Z'): WeightEntry => ({ id: `w-${seq++}`, date, weight, unit, createdAt })
/** Trend after the second reading when the first is 100 and the second is 200: 100 plus the fraction moved times 100. */
const secondTrend = (firstDate: string, secondDate: string) => withTrend([w(firstDate, 100), w(secondDate, 200)])[1].trend

describe('withTrend with gaps between readings', () => {
  it('moves 10 percent of the way for a next-day reading', () => {
    expect(secondTrend('2026-03-01', '2026-03-02')).toBeCloseTo(110, 10)
  })

  it('moves 1 - 0.9^7 (about 52.2 percent) of the way after a 7-day gap', () => {
    const moved = 1 - 0.9 ** 7
    expect(moved).toBeCloseTo(0.5217, 3)
    expect(secondTrend('2026-03-01', '2026-03-08')).toBeCloseTo(100 + moved * 100, 10)
  })

  it('moves about 89 percent of the way after a 21-day gap', () => {
    expect(secondTrend('2026-03-01', '2026-03-22')).toBeCloseTo(100 + (1 - 0.9 ** 21) * 100, 10)
    expect(secondTrend('2026-03-01', '2026-03-22')).toBeGreaterThan(188)
  })

  it('moves a longer gap further than a shorter one', () => {
    expect(secondTrend('2026-03-01', '2026-03-04')).toBeGreaterThan(secondTrend('2026-03-01', '2026-03-03'))
  })

  it('treats two readings on the same date as next-day readings (days floored at 1)', () => {
    const out = withTrend([w('2026-03-01', 100), w('2026-03-01', 200), w('2026-03-01', 200)])
    expect(out[1].trend).toBeCloseTo(110, 10)
    expect(out[2].trend).toBeCloseTo(110 + 0.1 * 90, 10)
  })

  it('starts the trend at the first reading, whatever date it has', () => {
    expect(withTrend([w('2026-03-09', 187.4)])[0].trend).toBe(187.4)
  })

  it('counts days across a month end', () => {
    // Jan 30 to Feb 2 is 3 days.
    expect(secondTrend('2026-01-30', '2026-02-02')).toBeCloseTo(100 + (1 - 0.9 ** 3) * 100, 10)
  })

  it('counts a leap day in a leap year (Feb 27 to Mar 2, 2028 is 4 days) but not otherwise (2026 is 3)', () => {
    expect(secondTrend('2028-02-27', '2028-03-02')).toBeCloseTo(100 + (1 - 0.9 ** 4) * 100, 10)
    expect(secondTrend('2026-02-27', '2026-03-02')).toBeCloseTo(100 + (1 - 0.9 ** 3) * 100, 10)
  })

  it('counts whole days across a daylight saving change', () => {
    // US clocks spring forward on 2026-03-08; the calendar gap is still 3 days.
    expect(secondTrend('2026-03-07', '2026-03-10')).toBeCloseTo(100 + (1 - 0.9 ** 3) * 100, 10)
  })

  it('chains gaps: each reading uses the gap to the one before it', () => {
    const out = withTrend([w('2026-03-01', 100), w('2026-03-02', 200), w('2026-03-09', 100)])
    expect(out[1].trend).toBeCloseTo(110, 10)
    expect(out[2].trend).toBeCloseTo(110 + (1 - 0.9 ** 7) * (100 - 110), 10)
  })
})

describe('trendSeries with gaps', () => {
  it('converts mixed units before applying the gap-aware smoothing', () => {
    const out = trendSeries([w('2026-03-01', 100, 'lb'), w('2026-03-08', 100, 'kg')], 'lb')
    const second = 100 * LB_PER_KG
    expect(out[0].trend).toBe(100)
    expect(out[1].trend).toBeCloseTo(100 + (1 - 0.9 ** 7) * (second - 100), 8)
    expect(out[1].unit).toBe('lb')
  })

  it('orders same-date readings by createdAt, so the later one is latest and moves next-day', () => {
    const out = trendSeries([
      w('2026-03-02', 200, 'lb', '2026-03-02T09:00:00.000Z'),
      w('2026-03-02', 100, 'lb', '2026-03-02T07:00:00.000Z'),
    ], 'lb')
    expect(out.map((e) => e.weight)).toEqual([100, 200])
    expect(out[1].trend).toBeCloseTo(110, 10)
  })
})
