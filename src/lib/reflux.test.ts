import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Symptom } from '../types'
import { listTriggers, refluxDay, refluxReport, triggersIn } from './reflux'
import { isRefluxWatchOn, pickMascotLine } from './mascot'
import { shiftDate } from './utils'

const today = '2026-10-09'
const stamp = '2026-10-01T00:00:00.000Z'
let seq = 0
const e = (name: string, over: Partial<DiaryEntry> = {}): DiaryEntry => ({ id: `e${seq++}`, date: today, meal: 'lunch', name, calories: 200, protein: 5, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over })
// Older days, so today is never also a day Pip grows a stage.
const history = [shiftDate(today, -20), shiftDate(today, -21), shiftDate(today, -22), shiftDate(today, -23)].map((date) => e('Rice', { date }))

describe('triggersIn', () => {
  it('finds_common_triggers_by_whole_word_in_custom_and_usda_names', () => {
    expect(triggersIn('Beverages, coffee, brewed, prepared with tap water')).toEqual(['coffee'])
    expect(triggersIn('Spaghetti with marinara')).toEqual(['tomato'])
    expect(triggersIn('Candies, milk chocolate')).toEqual(['chocolate'])
    expect(triggersIn('Chicken tikka curry with garlic naan')).toEqual(['spicy food', 'onion and garlic'])
    expect(triggersIn('Oatmeal with banana')).toEqual([])
    expect(triggersIn('Peppermint tea')).toEqual(['mint'])
    expect(triggersIn('Tomatillo')).toEqual([])
  })
})

describe('refluxDay', () => {
  it('collects_distinct_triggers_from_todays_eaten_food_only', () => {
    const day = refluxDay([e('Latte', { time: '08:00' }), e('Black coffee', { time: '10:00' }), e('Orange juice', { time: '09:00' }), e('Pizza', { planned: true }), e('Chocolate', { date: shiftDate(today, -1) })], today)
    expect(day.triggers).toEqual(['coffee', 'citrus'])
    expect(day.level).toBe(1)
  })

  it('counts_a_fatty_meal_and_raises_the_level_at_three_triggers', () => {
    const day = refluxDay([e('Burger', { fat: 32 }), e('Cola'), e('Fries')], today)
    expect(day.triggers).toEqual(['a fatty meal', 'fizzy drinks', 'fried food'])
    expect(day.level).toBe(2)
  })

  it('flags_a_late_heavy_meal_and_ignores_a_late_snack', () => {
    expect(refluxDay([e('Rice and beans', { time: '21:15', calories: 650 })], today)).toMatchObject({ lateMeal: true, level: 1, triggers: [] })
    expect(refluxDay([e('Apple', { time: '21:15', calories: 95, fat: 0 })], today)).toMatchObject({ lateMeal: false, level: 0 })
    expect(refluxDay([e('Pasta with tomato sauce', { time: '21:30', calories: 700 })], today).level).toBe(2)
  })

  it('reads_lists_naturally', () => {
    expect(listTriggers(['coffee'])).toBe('coffee')
    expect(listTriggers(['coffee', 'tomato', 'chocolate'])).toBe('coffee, tomato and chocolate')
  })
})

describe('Pip with reflux watch', () => {
  it('is_off_unless_turned_on', () => {
    expect(isRefluxWatchOn(undefined)).toBe(false)
    expect(isRefluxWatchOn({ refluxWatch: true })).toBe(true)
    const entries = [...history, e('Black coffee')]
    expect(pickMascotLine({ date: today, today, hour: 12, entries, weights: [] })?.mood).not.toBe('uneasy')
  })

  it('gets_uneasy_and_names_the_triggers_when_on', () => {
    const one = pickMascotLine({ date: today, today, hour: 12, entries: [...history, e('Black coffee')], weights: [], reflux: true })
    expect(one).toMatchObject({ mood: 'uneasy' })
    expect(one?.text).toBe('Heads up: coffee is a common reflux trigger.')
    const three = pickMascotLine({ date: today, today, hour: 12, entries: [...history, e('Black coffee'), e('Pizza'), e('Chocolate cake')], weights: [], reflux: true })
    expect(three?.text).toBe('Tummy’s grumbling: coffee, tomato and chocolate today. Common reflux triggers, so go gentle.')
    expect(three?.id).not.toBe(one?.id)
  })

  it('stays_its_usual_self_on_a_day_without_triggers', () => {
    expect(pickMascotLine({ date: today, today, hour: 12, entries: [...history, e('Rice')], weights: [], reflux: true })?.mood).not.toBe('uneasy')
  })
})

describe('refluxReport', () => {
  const flare = (date: string, time?: string, severity: 1 | 2 | 3 = 2): Symptom => ({ id: `s${seq++}`, date, time, kind: 'heartburn', severity, createdAt: stamp, updatedAt: stamp })
  // Ten logged days. Coffee on the four flare days only; rice every day; cola on one flare day and three quiet ones.
  const days = Array.from({ length: 10 }, (_, index) => shiftDate(today, -index))
  const meals = days.flatMap((date, index) => [e('Rice', { date, time: '12:00' }), ...(index < 5 ? [e('Black coffee', { date, time: '08:00' })] : []), ...([0, 5, 6, 7].includes(index) ? [e('Cola', { date, time: '13:00' })] : [])])
  const flares = days.slice(0, 5).map((date) => flare(date, '09:30'))

  it('stays_quiet_until_there_are_enough_flares_and_logged_days', () => {
    const few = refluxReport(meals, flares.slice(0, 4), today)
    expect(few).toMatchObject({ flares: 4, loggedDays: 10, enough: false, findings: [] })
    expect(refluxReport(meals.filter((meal) => meal.date >= shiftDate(today, -5)), flares, today).enough).toBe(false)
  })

  it('names_triggers_that_come_before_flares_more_than_on_ordinary_days', () => {
    const report = refluxReport(meals, flares, today)
    expect(report.enough).toBe(true)
    expect(report.byPeriod).toEqual({ morning: 5, afternoon: 0, evening: 0, night: 0 })
    expect(report.findings.map((finding) => finding.label)).toEqual(['coffee'])
    expect(report.findings[0]).toMatchObject({ flaresWithTrigger: 5, flares: 5, daysWithTrigger: 5, loggedDays: 10, lift: 2 })
  })

  it('only_counts_food_eaten_in_the_hours_before_a_timed_flare', () => {
    // Cola at 13:00 is after the 09:30 flares, so it never counts even though it is on a flare day.
    const report = refluxReport(meals, flares, today)
    expect(report.findings.some((finding) => finding.label === 'fizzy drinks')).toBe(false)
    // Without a flare time, anything eaten that day counts.
    const untimed = refluxReport(meals, flares.map((item) => ({ ...item, time: undefined })), today)
    expect(untimed.findings.map((finding) => finding.label)).toContain('coffee')
    expect(untimed.byPeriod.evening).toBe(5)
  })

  it('ignores_planned_food_and_anything_outside_the_window', () => {
    const report = refluxReport([...meals, e('Chocolate', { date: shiftDate(today, -40), time: '08:00' }), e('Pizza', { planned: true, time: '08:00' })], [...flares, flare(shiftDate(today, -40), '09:00')], today)
    expect(report.flares).toBe(5)
    expect(report.findings.map((finding) => finding.label)).toEqual(['coffee'])
  })
})
