import { describe, expect, it } from 'vitest'
import type { WeightEntry } from '../types'
import { LB_PER_KG, TREND_SMOOTHING, convertWeight, trendSeries, withTrend } from './trend'

const w = (date: string, weight: number, unit: 'lb' | 'kg' = 'lb'): WeightEntry => ({ id: `w-${date}-${weight}`, date, weight, unit, createdAt: '2026-01-01T00:00:00.000Z' })

describe('withTrend', () => {
  it('returns an empty list for no entries', () => {
    expect(withTrend([])).toEqual([])
  })

  it('starts the trend at the first weight for a single entry', () => {
    expect(withTrend([w('2026-03-01', 180)]).map((e) => e.trend)).toEqual([180])
  })

  it('moves each trend a tenth of the way toward the next reading', () => {
    const out = withTrend([w('2026-03-01', 180), w('2026-03-02', 190), w('2026-03-03', 170)])
    expect(TREND_SMOOTHING).toBe(0.1)
    expect(out[0].trend).toBe(180)
    expect(out[1].trend).toBeCloseTo(181, 10)
    expect(out[2].trend).toBeCloseTo(181 + 0.1 * (170 - 181), 10)
  })

  it('keeps the original fields on each entry', () => {
    const out = withTrend([{ ...w('2026-03-01', 180), note: 'after run' }])
    expect(out[0].note).toBe('after run')
    expect(out[0].weight).toBe(180)
  })
})

describe('trendSeries', () => {
  it('sorts oldest first regardless of input order', () => {
    const out = trendSeries([w('2026-03-03', 170), w('2026-03-01', 180), w('2026-03-02', 190)], 'lb')
    expect(out.map((e) => e.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03'])
    expect(out[0].trend).toBe(180)
  })

  it('converts kg readings to lb and labels the unit', () => {
    const out = trendSeries([w('2026-03-01', 100, 'kg')], 'lb')
    expect(out[0].weight).toBeCloseTo(100 * LB_PER_KG, 6)
    expect(out[0].unit).toBe('lb')
  })

  it('converts lb readings to kg', () => {
    const out = trendSeries([w('2026-03-01', 220.46226218, 'lb')], 'kg')
    expect(out[0].weight).toBeCloseTo(100, 6)
    expect(out[0].unit).toBe('kg')
  })

  it('mixes units into one series', () => {
    const out = trendSeries([w('2026-03-01', 180, 'lb'), w('2026-03-02', 180 / LB_PER_KG, 'kg')], 'lb')
    expect(out[1].weight).toBeCloseTo(180, 6)
    expect(out[1].trend).toBeCloseTo(180, 6)
  })

  it('skips zero, negative, NaN and infinite weights', () => {
    const out = trendSeries([
      w('2026-03-01', 0), w('2026-03-02', -5), w('2026-03-03', Number.NaN), w('2026-03-04', Number.POSITIVE_INFINITY),
      w('2026-03-05', Number.NEGATIVE_INFINITY), w('2026-03-06', 180),
    ], 'lb')
    expect(out.map((e) => e.date)).toEqual(['2026-03-06'])
    expect(out[0].trend).toBe(180)
  })

  it('does not let a skipped bad row disturb the trend', () => {
    const out = trendSeries([w('2026-03-01', 180), w('2026-03-02', 0), w('2026-03-03', 190)], 'lb')
    expect(out).toHaveLength(2)
    expect(out[0].trend).toBe(180)
    expect(out[1].trend).toBeCloseTo(181, 10)
  })

  it('does not mutate its input', () => {
    const input = [w('2026-03-02', 190), w('2026-03-01', 180)]
    trendSeries(input, 'kg')
    expect(input.map((e) => e.date)).toEqual(['2026-03-02', '2026-03-01'])
    expect(input[0].weight).toBe(190)
  })
})

describe('convertWeight', () => {
  it('returns the same value when units match', () => {
    expect(convertWeight(180, 'lb', 'lb')).toBe(180)
    expect(convertWeight(80, 'kg', 'kg')).toBe(80)
  })

  it('round trips lb to kg and back', () => {
    expect(convertWeight(convertWeight(180, 'lb', 'kg'), 'kg', 'lb')).toBeCloseTo(180, 10)
    expect(convertWeight(convertWeight(80, 'kg', 'lb'), 'lb', 'kg')).toBeCloseTo(80, 10)
  })

  it('uses the standard factor', () => {
    expect(convertWeight(1, 'kg', 'lb')).toBeCloseTo(2.2046, 4)
  })
})
