import { describe, expect, it } from 'vitest'
import { axisDateLabel, axisNeedsYear, downsampleWeights, yAxisTicks } from './chartAxis'
import type { TrendedWeight } from './trend'

const day = (offset: number) => { const d = new Date(2024, 0, 1 + offset, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const series = (count: number): TrendedWeight[] => Array.from({ length: count }, (_, i) => ({ id: `w${i}`, date: day(i), weight: 200 - i * 0.05, unit: 'lb', trend: 200 - i * 0.05, createdAt: '', updatedAt: '' }))

describe('weight chart axes', () => {
  it('leaves short series alone', () => expect(downsampleWeights(series(100))).toHaveLength(100))
  it('averages a 500 point history to at most 120 points, in order, inside the original range', () => {
    const input = series(500)
    const out = downsampleWeights(input)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.length).toBeGreaterThan(30)
    expect(out.map((p) => p.date)).toEqual([...out.map((p) => p.date)].sort())
    expect(Math.max(...out.map((p) => p.weight))).toBeLessThanOrEqual(200)
    expect(Math.min(...out.map((p) => p.weight))).toBeGreaterThanOrEqual(input[499].weight)
  })
  it('gives min, mid and max ticks, top first', () => {
    expect(yAxisTicks(150.2, 181.8)).toEqual([182, 166, 150])
    expect(yAxisTicks(180.1, 182.3)).toEqual([182.3, 181.2, 180.1])
  })
  it('adds the year when the range crosses years or is not this year', () => {
    expect(axisNeedsYear('2025-03-01', '2026-02-01', '2026-10-21')).toBe(true)
    expect(axisNeedsYear('2025-03-01', '2025-09-01', '2026-10-21')).toBe(true)
    expect(axisNeedsYear('2026-03-01', '2026-10-21', '2026-10-21')).toBe(false)
    expect(axisDateLabel('2025-03-09', true)).toMatch(/Mar.*2025/)
    expect(axisDateLabel('2026-03-09', false)).toMatch(/Mar.*9/)
  })
})
