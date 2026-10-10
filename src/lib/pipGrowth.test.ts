import { describe, expect, it } from 'vitest'
import type { DiaryEntry } from '../types'
import { pipGrowth, stageForDays } from './pipGrowth'
import { pickMascotLine } from './mascot'
import { shiftDate } from './utils'

const today = '2026-10-09'
const stamp = '2026-10-01T00:00:00.000Z'
let seq = 0
const e = (offset: number, planned = false): DiaryEntry => ({ id: `e${seq++}`, date: shiftDate(today, offset), meal: 'lunch', name: 'Food', calories: 300, protein: 10, carbs: 30, fat: 10, planned, createdAt: stamp, updatedAt: stamp })
const days = (...offsets: number[]) => offsets.map((offset) => e(offset))

describe('pipGrowth', () => {
  it('maps_logged_days_to_stages', () => {
    expect([0, 2, 3, 6, 7, 13, 14, 29, 30, 400].map(stageForDays)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('counts_distinct_eaten_days_over_all_time_never_planned_or_future_ones', () => {
    const growth = pipGrowth([...days(0, 0, -1, -40), e(-2, true), e(3)], today)
    expect(growth.days).toBe(3)
    expect(growth).toMatchObject({ stage: 1, name: 'Seedling', next: { name: 'Budding', remaining: 4 } })
  })

  it('never_shrinks_after_a_long_gap', () => {
    const growth = pipGrowth(days(-100, -99, -98, -97, -96, -95, -94), today)
    expect(growth).toMatchObject({ stage: 2, grewToday: false })
  })

  it('knows_when_todays_logging_reached_a_new_stage', () => {
    expect(pipGrowth(days(0, -1, -2), today).grewToday).toBe(true)
    expect(pipGrowth(days(-1, -2, -3), today).grewToday).toBe(false)
    expect(pipGrowth(days(0, -1, -2, -3), today).grewToday).toBe(false)
    expect(pipGrowth(days(0), today).grewToday).toBe(false)
  })

  it('has_no_next_stage_once_fully_grown', () => {
    const growth = pipGrowth(days(...Array.from({ length: 30 }, (_, index) => -index)), today)
    expect(growth).toMatchObject({ stage: 4, name: 'Flourishing', grewToday: true })
    expect(growth.next).toBeUndefined()
  })
})

describe('Pip says it grew', () => {
  it('cheers_on_the_day_a_stage_is_reached_and_not_after', () => {
    const grew = pickMascotLine({ date: today, today, hour: 12, entries: days(0, -1, -2, -3, -4, -5, -6), weights: [] })
    expect(grew).toMatchObject({ id: 'grew-2', mood: 'cheer' })
    expect(grew?.text).toMatch(/bud/i)
    const later = pickMascotLine({ date: today, today, hour: 12, entries: days(0, -1, -2, -3, -4, -5, -6, -7), weights: [] })
    expect(later?.id).not.toMatch(/^grew/)
  })
})
