// An unfinished day must not count as a logged day: callers pass yesterday as the end date.
import { describe, expect, it } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import { estimateExpenditure } from './expenditure'
import { shiftDate } from './utils'

const TODAY = '2026-03-15'
const stamp = '2026-01-01T00:00:00.000Z'
const ago = (offset: number) => shiftDate(TODAY, -offset)
let seq = 0
const eaten = (date: string, calories: number): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp })
const weigh = (date: string): WeightEntry => ({ id: `w-${date}`, date, weight: 180, unit: 'lb', createdAt: stamp })

// The audit repro: 26 full days at 2000 kcal, a 400 kcal breakfast today, flat weight, 7 weigh-ins over 24 days.
const fullDays = Array.from({ length: 26 }, (_, i) => eaten(ago(i + 1), 2000))
const breakfast = eaten(TODAY, 400)
const weights = [25, 21, 17, 13, 9, 5, 1].map((o) => weigh(ago(o)))

describe('estimateExpenditure through the last finished day', () => {
  it('ignores an entry dated today when the end date is yesterday', () => {
    const estimate = estimateExpenditure([...fullDays, breakfast], weights, ago(1))
    expect(estimate).toMatchObject({ kind: 'ok', kcalPerDay: 2000, avgIntake: 2000, loggedDays: 26 })
  })

  it('gives the same figure with and without the partial day today', () => {
    expect(estimateExpenditure([...fullDays, breakfast], weights, ago(1))).toEqual(estimateExpenditure(fullDays, weights, ago(1)))
  })

  it('shows the drag the unfinished day caused when today is the end date (the audit repro, 1941)', () => {
    const estimate = estimateExpenditure([...fullDays, breakfast], weights, TODAY)
    expect(estimate).toMatchObject({ kind: 'ok', kcalPerDay: 1941 })
  })
})
