import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Goals, WeightEntry } from '../types'
import { feedLine, isMascotOn, loggingStreak, mealForHour, petLine, pickMascotLine, pokeLine, shortFoodName } from './mascot'
import { shiftDate } from './utils'

const today = '2026-10-09'
const stamp = '2026-10-01T00:00:00.000Z'
let seq = 0
const e = (date: string, meal: DiaryEntry['meal'], over: Partial<DiaryEntry> = {}): DiaryEntry =>
  ({ id: `e${seq++}`, date, meal, name: 'Food', calories: 300, protein: 10, carbs: 30, fat: 10, createdAt: stamp, updatedAt: stamp, ...over })
const pick = (entries: DiaryEntry[], extra: { hour?: number; goals?: Goals; weights?: WeightEntry[]; date?: string } = {}) =>
  pickMascotLine({ date: extra.date ?? today, today, hour: extra.hour ?? 9, entries, weights: extra.weights ?? [], goals: extra.goals })

describe('isMascotOn', () => {
  it('is_on_when_missing_and_off_only_for_an_explicit_false', () => {
    expect(isMascotOn(undefined)).toBe(true)
    expect(isMascotOn({})).toBe(true)
    expect(isMascotOn({ mascot: true })).toBe(true)
    expect(isMascotOn({ mascot: false })).toBe(false)
  })
})

describe('mealForHour', () => {
  it('maps_the_clock_to_a_meal', () => {
    expect(mealForHour(7)).toBe('breakfast')
    expect(mealForHour(12)).toBe('lunch')
    expect(mealForHour(16)).toBe('snack')
    expect(mealForHour(19)).toBe('dinner')
    expect(mealForHour(2)).toBe('dinner')
  })
})

describe('loggingStreak', () => {
  it('counts_consecutive_eaten_days_ending_today_and_ignores_planned_entries', () => {
    const entries = [e(today, 'lunch'), e(shiftDate(today, -1), 'lunch'), e(shiftDate(today, -2), 'lunch', { planned: true }), e(shiftDate(today, -3), 'lunch')]
    expect(loggingStreak(entries, today)).toBe(2)
    expect(loggingStreak([], today)).toBe(0)
  })
})

describe('pickMascotLine', () => {
  it('stays_quiet_on_any_day_but_today', () => {
    expect(pick([], { date: shiftDate(today, -1) })).toBeNull()
  })

  it('greets_by_time_of_day_and_offers_to_log_the_matching_meal', () => {
    const morning = pick([], { hour: 8 })
    expect(morning).toMatchObject({ mood: 'wave', action: 'log', meal: 'breakfast' })
    expect(pick([], { hour: 19 })).toMatchObject({ action: 'log', meal: 'dinner' })
  })

  it('offers_to_copy_yesterday_when_yesterday_was_logged', () => {
    expect(pick([e(shiftDate(today, -1), 'lunch')])).toMatchObject({ id: 'copy-yesterday', action: 'copy-yesterday' })
  })

  it('welcomes_back_after_a_gap_without_guilt', () => {
    const line = pick([e(shiftDate(today, -5), 'lunch')])
    expect(line?.id).toBe('welcome-back')
    expect(line?.text).not.toMatch(/miss|forgot|behind/i)
  })

  it('ignores_planned_entries_when_deciding_whether_today_is_empty', () => {
    expect(pick([e(today, 'lunch', { planned: true })])?.action).toBe('log')
  })

  it('celebrates_the_first_entry_of_the_day', () => {
    expect(pick([e(today, 'breakfast')])).toMatchObject({ id: 'first', mood: 'happy' })
  })

  it('celebrates_a_protein_target_the_user_set', () => {
    expect(pick([e(today, 'lunch', { protein: 140 })], { goals: { protein: 120, weightUnit: 'lb' } })).toMatchObject({ id: 'protein', mood: 'proud' })
  })

  it('celebrates_all_three_main_meals', () => {
    expect(pick([e(today, 'breakfast'), e(today, 'lunch'), e(today, 'dinner')])?.id).toBe('all-meals')
  })

  it('celebrates_a_streak_of_three_or_more_days_early_in_the_day', () => {
    // An older day too, so today is not also the day Pip grows into a seedling.
    const entries = [e(today, 'breakfast'), e(shiftDate(today, -1), 'lunch'), e(shiftDate(today, -2), 'lunch'), e(shiftDate(today, -20), 'lunch')]
    expect(pick(entries)).toMatchObject({ id: 'streak-3', mood: 'cheer' })
  })

  it('stays_neutral_over_the_calorie_goal_and_never_rewards_eating_less', () => {
    const over = pick([e(today, 'breakfast', { calories: 1500 }), e(today, 'snack', { calories: 1500 })], { goals: { calories: 2000, weightUnit: 'lb' } })
    expect(over?.id).toBe('honest')
    const under = pick([e(today, 'breakfast', { calories: 200 }), e(today, 'snack', { calories: 100 })], { goals: { calories: 2000, weightUnit: 'lb' } })
    for (const line of [over, under]) expect(line?.text).not.toMatch(/under|less|deficit|lighter|lost|good job staying/i)
  })

  it('notices_a_weigh_in_without_judging_the_number', () => {
    const weights: WeightEntry[] = [{ id: 'w', date: today, weight: 180, unit: 'lb', createdAt: stamp }]
    const line = pick([e(today, 'breakfast'), e(today, 'snack')], { weights })
    expect(line?.id).toBe('weighed')
    expect(line?.text).not.toMatch(/180|down|up|lost|gained/i)
  })

  it('uses_the_same_wording_for_the_same_situation_on_the_same_day', () => {
    expect(pick([e(today, 'breakfast')])?.text).toBe(pick([e(today, 'breakfast')])?.text)
  })
})

describe('Pip’s moments', () => {
  it('shortens_usda_names_for_the_bubble', () => {
    expect(shortFoodName('Chicken, broilers or fryers, breast, meat only, cooked, roasted')).toBe('chicken')
    expect(shortFoodName('Greek yogurt with honey and walnuts and more')).toBe('greek yogurt with honey')
    expect(shortFoodName('Oatmeal')).toBe('oatmeal')
  })

  it('eats_with_a_line_that_names_the_food_and_is_stable_per_entry', () => {
    const line = feedLine('Bananas, raw', 'entry-1')
    expect(line.toLowerCase()).toContain('bananas')
    expect(feedLine('Bananas, raw', 'entry-1')).toBe(line)
  })

  it('gets_dizzy_at_three_quick_pokes_and_ticklish_at_five', () => {
    expect(pokeLine(1)).toEqual({ reaction: null, text: null })
    expect(pokeLine(3).reaction).toBe('dizzy')
    expect(pokeLine(5)).toMatchObject({ reaction: 'giggle' })
    expect(pokeLine(8).text).toContain('very ticklish')
    expect(petLine('a').length).toBeGreaterThan(0)
  })
})
