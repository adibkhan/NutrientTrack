import { describe, expect, it } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import { weeklyRecap } from './recap'
import { shiftDate } from './utils'

const today = '2026-10-09'
const stamp = '2026-10-01T00:00:00.000Z'
let seq = 0
const e = (offset: number, calories: number, protein: number, planned = false): DiaryEntry =>
  ({ id: `e${seq++}`, date: shiftDate(today, offset), meal: 'lunch', name: 'Food', calories, protein, carbs: 0, fat: 0, planned, createdAt: stamp, updatedAt: stamp })
const w = (offset: number, weight: number, unit: 'lb' | 'kg' = 'lb'): WeightEntry => ({ id: `w${seq++}`, date: shiftDate(today, offset), weight, unit, createdAt: stamp })

describe('weeklyRecap', () => {
  it('averages_over_logged_days_only_and_ignores_planned_and_older_entries', () => {
    const recap = weeklyRecap([e(0, 1000, 50), e(0, 500, 30), e(-2, 2000, 100), e(-1, 900, 10, true), e(-7, 5000, 500)], [], today, 'lb')
    expect(recap.start).toBe(shiftDate(today, -6))
    expect(recap.daysLogged).toBe(2)
    expect(recap.foodsLogged).toBe(3)
    expect(recap.avgCalories).toBe(1750)
    expect(recap.avgProtein).toBe(90)
    expect(recap.days.map((day) => day.logged)).toEqual([false, false, false, false, true, false, true])
    expect(recap.streak).toBe(1)
  })

  it('leaves_averages_and_weight_missing_without_data', () => {
    const recap = weeklyRecap([], [w(-1, 180)], today, 'lb')
    expect(recap.avgCalories).toBeUndefined()
    expect(recap.avgProtein).toBeUndefined()
    expect(recap.trendChange).toBeUndefined()
  })

  it('reports_the_trend_change_in_the_display_unit', () => {
    const recap = weeklyRecap([], [w(-6, 80, 'kg'), w(0, 79, 'kg')], today, 'kg')
    expect(recap.trendChange).toBeLessThan(0)
    expect(recap.trendChange).toBeGreaterThan(-1)
  })
})
