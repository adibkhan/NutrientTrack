// Uneven calorie days in Nutrition insights: each bar is compared with its own weekday's target.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiaryEntry, Goals } from '../types'
import { dateFromISO, shiftDate, todayISO } from '../lib/utils'
import NutritionInsights from './NutritionInsights'

afterEach(cleanup)
const stamp = '2026-01-01T00:00:00.000Z'
const entry = (daysAgo: number): DiaryEntry => ({ id: `e${daysAgo}`, name: 'Food', date: shiftDate(todayISO(), -daysAgo), meal: 'lunch', calories: 2000, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp })
const card = () => screen.getByRole('region', { name: 'Daily energy' })

describe('Nutrition insights with uneven days', () => {
  it('shows_one_target_tick_per_bar_at_each_days_own_target_and_says_the_goal_is_set_per_weekday', () => {
    const shift = [210, -90, -90, -80, -80, -80, 210]
    const goals: Goals = { weightUnit: 'lb', calories: 2100, calorieShift: shift }
    render(<NutritionInsights entries={[entry(0)]} goals={goals} />)
    expect(card().querySelectorAll('.bar-day-goal')).toHaveLength(7)
    expect(card().querySelector('.bar-goal')).toBeNull()
    expect(card().textContent).toMatch(/Goal averages 2,100 kcal, set per weekday/)
    const todayTitle = Array.from(card().querySelectorAll<HTMLElement>('.bar-col')).at(-1)?.getAttribute('title') ?? ''
    const expected = 2100 + shift[dateFromISO(todayISO()).getDay()]
    expect(todayTitle).toContain(`goal ${expected.toLocaleString()}`)
  })

  it('keeps_the_single_goal_line_when_no_shift_is_set', () => {
    render(<NutritionInsights entries={[entry(0)]} goals={{ weightUnit: 'lb', calories: 2100 }} />)
    expect(card().querySelectorAll('.bar-day-goal')).toHaveLength(0)
    expect(card().querySelector('.bar-goal')).not.toBeNull()
    expect(card().textContent).toMatch(/Goal 2,100 kcal/)
  })
})
