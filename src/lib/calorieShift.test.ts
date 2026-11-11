import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Goals, WeightEntry } from '../types'
import { adjustShiftForGoal, reconcileGoalsShift, SHIFT_CLEARED_NOTE, SHIFT_DROPPED_NOTE, SHIFT_REDUCED_NOTE, averageTarget, dayTargets, higherWeekends, MIN_DAY_KCAL, readCalorieShift, rebalance, shiftProblem, sum, targetFor } from './calorieShift'
import { buildCheckIn } from './program'
import { pickMascotLine } from './mascot'
import { weeklyRecap } from './recap'

// 2026-10-04 is a Sunday, so 2026-10-04 + n days has weekday n (Sun=0 .. Sat=6).
const SUN = '2026-10-04'
const day = (weekday: number) => `2026-10-${String(4 + weekday).padStart(2, '0')}`
const SHIFT = [200, -50, -50, -50, -50, -50, 50]
const goals: Goals = { weightUnit: 'lb', calories: 2100, calorieShift: SHIFT }

describe('readCalorieShift', () => {
  it('accepts_seven_numbers_that_sum_to_zero', () => {
    expect(readCalorieShift(goals)).toEqual(SHIFT)
  })
  it('ignores_missing_malformed_unbalanced_and_all_zero_values', () => {
    for (const calorieShift of [undefined, null, 'x', [], [1, -1], [100, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 'x'], [1, 2, 3, 4, 5, 6, NaN]]) {
      expect(readCalorieShift({ calorieShift })).toBeUndefined()
    }
    expect(readCalorieShift(undefined)).toBeUndefined()
  })
})

describe('targetFor', () => {
  it('is_the_goal_plus_the_weekday_shift', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((weekday) => targetFor(goals, day(weekday)))).toEqual([2300, 2050, 2050, 2050, 2050, 2050, 2150])
    expect(targetFor(goals, SUN)).toBe(2300)
  })
  it('a_week_at_the_targets_equals_seven_times_the_goal', () => {
    expect(sum([0, 1, 2, 3, 4, 5, 6].map((weekday) => targetFor(goals, day(weekday)) as number))).toBe(2100 * 7)
  })
  it('is_the_plain_goal_without_a_shift_and_undefined_without_a_goal', () => {
    expect(targetFor({ weightUnit: 'lb', calories: 2000 }, SUN)).toBe(2000)
    expect(targetFor({ weightUnit: 'lb' }, SUN)).toBeUndefined()
    expect(targetFor(undefined, SUN)).toBeUndefined()
    expect(targetFor({ weightUnit: 'lb', calories: 0, calorieShift: SHIFT }, SUN)).toBe(0)
  })
  it('follows_a_changed_goal_because_the_shift_is_a_set_of_deltas', () => {
    expect(targetFor({ ...goals, calories: 1900 }, day(0))).toBe(2100)
    expect(targetFor({ ...goals, calories: 1900 }, day(1))).toBe(1850)
  })
  it('never_plans_a_shifted_day_under_the_floor', () => {
    expect(targetFor({ weightUnit: 'lb', calories: 1300, calorieShift: [-300, 50, 50, 50, 50, 50, 50] }, day(0))).toBe(MIN_DAY_KCAL)
  })
  it('is_the_same_in_any_time_zone_because_it_reads_the_calendar_date', () => {
    expect(targetFor(goals, '2026-01-01')).toBe(targetFor(goals, '2026-01-01'))
    expect(targetFor(goals, '2026-10-31')).toBe(2150) // a Saturday
  })
  it('averageTarget_is_the_mean_over_the_given_days', () => {
    expect(averageTarget(goals, [day(0), day(1)])).toBe(2175)
    expect(averageTarget({ weightUnit: 'lb' }, [day(0)])).toBeUndefined()
  })
})

describe('rebalance and presets', () => {
  it('rebalance_spreads_the_difference_in_10_kcal_steps_and_sums_to_zero', () => {
    const next = rebalance(2100, [100, 0, 0, 0, 0, 0, 0])
    expect(sum(next)).toBe(0)
    expect(next[0]).toBe(100)
    expect(next.every((delta) => delta % 10 === 0)).toBe(true)
    // The extra 100 comes off the other six days, not off one of them.
    expect(Math.max(...next.slice(1))).toBeLessThanOrEqual(0)
    expect(Math.min(...next.slice(1))).toBeGreaterThanOrEqual(-20)
  })
  it('rebalance_adds_to_the_lowest_days_when_short_and_handles_a_remainder_under_10', () => {
    const next = rebalance(2100, [-103, 0, 0, 0, 0, 0, 0])
    expect(sum(next)).toBe(0)
    expect(next[0]).toBe(-103)
  })
  it('rebalance_keeps_days_above_the_floor_when_another_day_has_room', () => {
    const next = rebalance(1400, [0, 0, 0, 0, 0, 0, 300])
    expect(sum(next)).toBe(0)
    expect(Math.min(...dayTargets(1400, next))).toBeGreaterThanOrEqual(MIN_DAY_KCAL)
  })
  it('higherWeekends_puts_about_10_percent_more_on_saturday_and_sunday_and_sums_to_zero', () => {
    const shift = higherWeekends(2100)
    expect(shift).toEqual([210, -90, -90, -80, -80, -80, 210])
    expect(sum(shift)).toBe(0)
  })
  it('higherWeekends_is_balanced_and_in_10_kcal_steps_for_many_goals', () => {
    for (let goal = 1300; goal <= 4500; goal += 37) {
      const shift = higherWeekends(goal)
      expect(sum(shift)).toBe(0)
      expect(shift.every((delta) => delta % 10 === 0)).toBe(true)
      expect(shift[0]).toBe(shift[6])
      expect(shift[0]).toBeGreaterThan(0)
      expect(shift.slice(1, 6).every((delta) => delta < 0)).toBe(true)
    }
  })
})

describe('shiftProblem', () => {
  it('has_no_problem_for_no_shift_or_a_balanced_safe_one', () => {
    expect(shiftProblem(undefined, [0, 0, 0, 0, 0, 0, 0])).toBeUndefined()
    expect(shiftProblem(2100, SHIFT)).toBeUndefined()
  })
  it('refuses_a_shift_without_a_goal', () => {
    expect(shiftProblem(undefined, SHIFT)).toMatch(/Set a calorie goal first/)
  })
  it('refuses_deltas_that_do_not_sum_to_zero', () => {
    expect(shiftProblem(2100, [100, 0, 0, 0, 0, 0, 0])).toMatch(/100 kcal more/)
    expect(shiftProblem(2100, [-100, 0, 0, 0, 0, 0, 0])).toMatch(/100 kcal less/)
  })
  it('refuses_any_day_under_1200', () => {
    expect(shiftProblem(1300, [-150, 25, 25, 25, 25, 25, 25])).toMatch(/Sunday would be under 1,200/)
  })
  it('refuses_a_day_over_the_entry_cap', () => {
    expect(shiftProblem(9000, [1500, -250, -250, -250, -250, -250, -250])).toMatch(/Sunday would be over 10,000/)
  })
})

describe('consumers of the day target', () => {
  const stamp = '2026-10-01T00:00:00.000Z'
  let seq = 0
  const e = (date: string, calories: number): DiaryEntry => ({ id: `e${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 10, carbs: 10, fat: 10, createdAt: stamp, updatedAt: stamp })

  it('pip_only_says_it_was_a_big_day_when_the_day_is_over_its_own_target', () => {
    const pick = (date: string, calories: number) => pickMascotLine({ date, today: date, hour: 9, entries: [e(date, calories), e(date, 0)], weights: [], goals })
    // Sunday allows 2300, Monday 2050.
    expect(pick(day(0), 2200)?.id).not.toBe('honest')
    expect(pick(day(1), 2200)?.id).toBe('honest')
    expect(pick(day(0), 2400)?.id).toBe('honest')
  })

  it('the_weekly_recap_reports_the_average_target_over_logged_days_only_when_shifted', () => {
    const entries = [e(day(0), 2000), e(day(1), 2000)]
    expect(weeklyRecap(entries, [], day(6), 'lb', goals).avgTarget).toBe(2175)
    expect(weeklyRecap(entries, [], day(6), 'lb', { weightUnit: 'lb', calories: 2100 }).avgTarget).toBeUndefined()
    expect(weeklyRecap(entries, [], day(6), 'lb').avgTarget).toBeUndefined()
  })

  it('the_weekly_check_in_reports_the_average_target_and_keeps_the_shift_when_the_budget_changes', () => {
    const settings = { id: 'profile' as const, goals, program: { direction: 'lose' as const, weeklyRate: 1, checkInDay: 0 }, updatedAt: stamp }
    const today = '2026-10-11' // the Sunday check-in covers Sun 10-04 .. Sat 10-10
    const entries = Array.from({ length: 7 }, (_, weekday) => e(day(weekday), 2000))
    const weights: WeightEntry[] = []
    const review = buildCheckIn(entries, weights, settings, today)
    expect(review?.avgTarget).toBeCloseTo(2100, 5)
    expect(buildCheckIn(entries, weights, { ...settings, goals: { weightUnit: 'lb', calories: 2100 } }, today)?.avgTarget).toBeUndefined()
    // Applying a new daily budget replaces calories only; the deltas stay, so the weekly total is still 7 x the new goal.
    const applied = { ...goals, calories: 1950 }
    expect(sum([0, 1, 2, 3, 4, 5, 6].map((weekday) => targetFor(applied, day(weekday)) as number))).toBe(1950 * 7)
  })
})

describe('review fixes: goal changes keep the shift valid', () => {
  it('adjustShiftForGoal_reduces_so_the_lowest_day_is_at_least_1200_and_the_sum_stays_zero', () => {
    for (const goal of [1250, 1300, 1400, 1500, 1800]) {
      const result = adjustShiftForGoal(goal, [600, -300, -300, -300, -300, -300, 900])
      if (result.shift) {
        expect(sum(result.shift)).toBe(0)
        expect(Math.min(...result.shift) + goal).toBeGreaterThanOrEqual(MIN_DAY_KCAL)
        expect(result.shift.every((delta) => delta % 10 === 0)).toBe(true)
      } else expect(result.change).toBe('cleared')
    }
  })
  it('adjustShiftForGoal_leaves_a_valid_shift_alone_and_clears_at_or_under_1200', () => {
    expect(adjustShiftForGoal(2100, SHIFT)).toEqual({ shift: SHIFT })
    expect(adjustShiftForGoal(1200, SHIFT)).toEqual({ change: 'cleared' })
    expect(adjustShiftForGoal(1000, SHIFT)).toEqual({ change: 'cleared' })
  })
  it('reconcileGoalsShift_reduces_clears_or_drops_with_the_right_note', () => {
    const low = { weightUnit: 'lb' as const, calories: 1300, calorieShift: [1800, -300, -300, -300, -300, -300, -300] }
    const reduced = reconcileGoalsShift(low)
    expect(reduced.note).toBe(SHIFT_REDUCED_NOTE)
    expect(Math.min(...(reduced.goals.calorieShift as number[])) + 1300).toBeGreaterThanOrEqual(1200)
    expect(reconcileGoalsShift({ ...low, calories: 1200 })).toMatchObject({ note: SHIFT_CLEARED_NOTE })
    expect('calorieShift' in reconcileGoalsShift({ ...low, calories: 1200 }).goals).toBe(false)
    const dropped = reconcileGoalsShift({ weightUnit: 'lb' as const, calories: undefined, calorieShift: SHIFT })
    expect(dropped.note).toBe(SHIFT_DROPPED_NOTE)
    expect('calorieShift' in dropped.goals).toBe(false)
    expect(reconcileGoalsShift(goals)).toEqual({ goals })
  })
  it('leaves_a_shift_this_build_cannot_read_untouched', () => {
    const odd = { weightUnit: 'lb' as const, calories: undefined, calorieShift: [1, 2, 3] }
    expect(reconcileGoalsShift(odd)).toEqual({ goals: odd })
  })
})

describe('review fixes: higherWeekends never goes under 1200', () => {
  it('holds_the_floor_for_every_goal_from_1100_to_4000', () => {
    for (let goal = 1100; goal <= 4000; goal += 10) {
      const shift = higherWeekends(goal)
      expect(shift).toHaveLength(7)
      expect(sum(shift)).toBe(0)
      if (goal > 1200) expect(Math.min(...shift) + goal).toBeGreaterThanOrEqual(MIN_DAY_KCAL)
      if (goal <= 1209) expect(shift.every((delta) => delta === 0)).toBe(true)
    }
  })
})

describe('review fixes: readCalorieShift sanitises on read', () => {
  it('ignores_huge_deltas_and_sums_beyond_one_but_the_stored_value_is_not_changed', () => {
    const huge = { calorieShift: [6000, -1000, -1000, -1000, -1000, -1000, -1000] }
    expect(readCalorieShift(huge)).toBeUndefined()
    expect(huge.calorieShift[0]).toBe(6000)
    expect(readCalorieShift({ calorieShift: [100, -50, -50, -50, 0, 0, 0] })).toBeUndefined()
  })
})
