import { describe, expect, it } from 'vitest'
import type { DiaryEntry } from '../types'
import { coverageNote, MIN_DAY_KCAL, MIN_RECORDED_DAYS, percentOfDv, rangeTotals, recordedAverages, summarizeNutrientTrends } from './nutrientTrends'
import { shiftDate } from './utils'

const stamp = '2026-01-01T00:00:00.000Z'
const END = '2026-06-10'
let n = 0
const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: `e-${++n}`, date: END, meal: 'lunch', name: 'Food', calories: 700, protein: 10, carbs: 10, fat: 1, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry
const on = (offset: number, over: Record<string, unknown> = {}) => entry({ date: shiftDate(END, -offset), ...over })
const days = (count: number, over: Record<string, unknown>) => Array.from({ length: count }, (_, i) => on(i, over))
const row = (entries: DiaryEntry[], key: string, range: 7 | 30 | 90 = 30) => {
  const t = summarizeNutrientTrends(entries, END, range)
  return [...t.aim, ...t.limit, ...t.other].find((r) => r.info.key === key)
}

describe('which days count toward a nutrient', () => {
  it('counts only days where foods that recorded it are at least 80% of the day calories: 4 of 10 days fully recorded', () => {
    const entries = Array.from({ length: 10 }, (_, i) => on(i, i < 4 ? { fiber: 28 } : {}))
    const fiber = row(entries, 'fiber')!
    expect(fiber.average).toBe(28)
    expect(fiber.recordedDays).toBe(4)
    expect(fiber.loggedDays).toBe(10)
    expect(coverageNote(fiber)).toBe('4 of 10 days fully recorded')
  })

  it('leaves out a mixed day where half the calories came from foods with no calcium, instead of halving the average', () => {
    const mixed = Array.from({ length: 10 }, (_, i) => [on(i, { calcium: 650 }), on(i, { name: 'Manual' })]).flat()
    expect(row(mixed, 'calcium')).toBeUndefined()
  })

  it('counts a day when the unrecorded foods are under 20% of its calories', () => {
    const entries = Array.from({ length: 3 }, (_, i) => [on(i, { calories: 1000, calcium: 600 }), on(i, { calories: 200, name: 'Tea' })]).flat()
    const calcium = row(entries, 'calcium')!
    expect(calcium.recordedDays).toBe(3)
    expect(calcium.average).toBe(600)
  })

  it('skips a snack-only day: 4 days at 28 g and one 20 kcal snack with 0.3 g still averages 28 g', () => {
    const entries = [...days(4, { calories: 2000, fiber: 28 }), on(4, { calories: 20, fiber: 0.3 })]
    const fiber = row(entries, 'fiber')!
    expect(fiber.average).toBe(28)
    expect(fiber.recordedDays).toBe(4)
    expect(fiber.loggedDays).toBe(4)
    const t = summarizeNutrientTrends(entries, END, 30)
    expect(t.loggedDays).toBe(5)
    expect(t.skippedDays).toBe(1)
    expect(MIN_DAY_KCAL).toBe(600)
  })

  it('has no row for a nutrient nothing recorded, and none for a diary of manual entries', () => {
    const t = summarizeNutrientTrends([on(0), on(1)], END, 30)
    expect([...t.aim, ...t.limit, ...t.other]).toEqual([])
    expect(t.loggedDays).toBe(2)
  })

  it('keeps a recorded zero as data', () => {
    expect(row(days(3, { vitaminB12: 0 }), 'vitaminB12')?.average).toBe(0)
  })

  it('has no coverage note when every counted day recorded the nutrient', () => {
    const iron = row(days(2, { iron: 9 }), 'iron')!
    expect(coverageNote(iron)).toBe('')
  })

  it('leaves planned foods and days outside the range out', () => {
    const entries = [...days(3, { zinc: 3 }), on(0, { zinc: 500, planned: true }), on(40, { zinc: 500 })]
    expect(row(entries, 'zinc')?.average).toBe(3)
    expect(row(entries, 'zinc', 90)?.recordedDays).toBe(4)
  })
})

describe('ranking and thin averages', () => {
  it('sorts aim-for with the biggest shortfall first and limits with the biggest overage first', () => {
    const t = summarizeNutrientTrends(days(3, { fiber: 28, calcium: 130, iron: 9, sodium: 1150, satFat: 40, cholesterol: 150 }), END, 7)
    expect(t.aim.map((r) => r.info.key)).toEqual(['calcium', 'iron', 'fiber'])
    expect(t.limit.map((r) => r.info.key)).toEqual(['satFat', 'sodium', 'cholesterol'])
  })

  it('ranks an average over fewer than three days after the better-covered ones, and says not enough data while all are thin', () => {
    const entries = [...days(MIN_RECORDED_DAYS, { iron: 9 }), on(5, { calcium: 13 })]
    const t = summarizeNutrientTrends(entries, END, 30)
    expect(t.aim.map((r) => [r.info.key, r.thin])).toEqual([['iron', false], ['calcium', true]])
    expect(t.notEnoughYet).toBe(false)
    expect(summarizeNutrientTrends([on(0, { iron: 9 }), on(1, { iron: 9 })], END, 30).notEnoughYet).toBe(true)
    expect(summarizeNutrientTrends([on(0)], END, 30).notEnoughYet).toBe(false)
  })

  it('puts nutrients without a daily value in their own list, with no share', () => {
    const t = summarizeNutrientTrends(days(3, { caffeine: 95, sugar: 12, omega3: 1.1 }), END, 7)
    expect(t.other.map((r) => r.info.key).sort()).toEqual(['caffeine', 'omega3', 'sugar'])
    expect(t.other.every((r) => r.share === undefined)).toBe(true)
  })
})

describe('one pass over the range', () => {
  it('returns the same totals object for the same entries, end date and range, and a new one when the entries change', () => {
    const entries = days(5, { iron: 9 })
    expect(rangeTotals(entries, END, 30)).toBe(rangeTotals(entries, END, 30))
    expect(rangeTotals(entries, END, 30)).not.toBe(rangeTotals(entries, END, 7))
    expect(rangeTotals([...entries], END, 30)).not.toBe(rangeTotals(entries, END, 30))
  })

  it('gives the contributors table the average per day that recorded each metric', () => {
    const entries = [on(0, { magnesium: 100 }), on(1), on(2, { magnesium: 200 })]
    const averages = recordedAverages(entries, END, 7)
    expect(averages.get('magnesium')).toBe(150)
    expect(averages.get('calories')).toBe(700)
    expect(averages.has('zinc')).toBe(false)
  })

  it('handles 6000 entries over 90 days in well under a second', () => {
    const entries = Array.from({ length: 6000 }, (_, i) => on(i % 90, { potassium: 100, calcium: 50, vitaminC: 5, iron: 1, fiber: 2, sodium: 300 }))
    const start = performance.now()
    summarizeNutrientTrends(entries, END, 90)
    expect(performance.now() - start).toBeLessThan(250)
  })
})

describe('percentOfDv', () => {
  it('rounds to a whole percent', () => {
    expect(percentOfDv(2500, 4700)).toBe(53)
    expect(percentOfDv(2300, 2300)).toBe(100)
  })
})
