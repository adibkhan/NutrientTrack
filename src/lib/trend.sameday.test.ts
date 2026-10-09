// Two weigh-ins on one date keep the order they were logged in, whatever order storage returns them.
import { describe, expect, it } from 'vitest'
import type { WeightEntry } from '../types'
import { trendSeries } from './trend'

const w = (id: string, date: string, weight: number, createdAt?: string): WeightEntry => ({ id, date, weight, unit: 'lb', ...(createdAt ? { createdAt } : {}) }) as WeightEntry

describe('trendSeries ties on date', () => {
  const early = w('early', '2026-03-10', 180, '2026-03-10T07:00:00.000Z')
  const late = w('late', '2026-03-10', 182, '2026-03-10T20:00:00.000Z')

  it('puts the later createdAt last when storage returns it first', () => {
    expect(trendSeries([late, early], 'lb').map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('gives the same order when storage returns the earlier one first', () => {
    expect(trendSeries([early, late], 'lb').map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('moves the trend from the earlier reading to the later one', () => {
    const series = trendSeries([late, early], 'lb')
    expect(series[0].trend).toBe(180)
    expect(series[1].trend).toBeCloseTo(180.2, 5)
  })

  it('still orders by date before createdAt', () => {
    const older = w('older', '2026-03-09', 170, '2026-03-12T00:00:00.000Z')
    expect(trendSeries([late, older], 'lb').map((e) => e.id)).toEqual(['older', 'late'])
  })

  it('does not throw for records without createdAt', () => {
    expect(trendSeries([w('b', '2026-03-10', 181, '2026-03-10T00:00:00.000Z'), w('a', '2026-03-10', 180)], 'lb').map((e) => e.id)).toEqual(['a', 'b'])
  })
})
