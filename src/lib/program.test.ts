import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Program, Settings, WeightEntry } from '../types'
import { LB_PER_KG } from './trend'
import { shiftDate } from './utils'
import { MIN_BUDGET_KCAL, budgetFor, buildCheckIn, goalProgress, isCheckInDue, lastCheckInDate, readProgram } from './program'

const stamp = '2026-01-01T00:00:00.000Z'
// 2026-03-15 is a Sunday. Weekday 0 = Sunday.
const SUNDAY = '2026-03-15'
const WEDNESDAY = '2026-03-18'

describe('readProgram', () => {
  it('returns an empty program for null, undefined, strings, numbers and arrays', () => {
    for (const junk of [null, undefined, 'x', 5, true, [], [1, 2]]) expect(readProgram(junk)).toEqual({})
  })

  it('keeps every valid field', () => {
    const valid = { direction: 'lose', goalWeight: 170, weeklyRate: 1, proteinPerWeight: 0.8, checkInDay: 0, lastCheckIn: '2026-03-08' }
    expect(readProgram(valid)).toEqual(valid)
  })

  it('drops unknown fields and an unknown direction', () => {
    expect(readProgram({ direction: 'fly', futureField: 1 })).toEqual({})
  })

  it('drops negative, zero, NaN, infinite and string numbers', () => {
    const out = readProgram({ goalWeight: -1, weeklyRate: 0, proteinPerWeight: Number.NaN, checkInDay: '3' })
    expect(out).toEqual({})
    expect(readProgram({ goalWeight: Number.POSITIVE_INFINITY, weeklyRate: '1' })).toEqual({})
  })

  it('accepts check-in days 0 and 6 and drops 7, -1 and 1.5', () => {
    expect(readProgram({ checkInDay: 0 }).checkInDay).toBe(0)
    expect(readProgram({ checkInDay: 6 }).checkInDay).toBe(6)
    for (const bad of [7, -1, 1.5, Number.NaN]) expect(readProgram({ checkInDay: bad }).checkInDay).toBeUndefined()
  })

  it('drops a malformed lastCheckIn but keeps the rest', () => {
    for (const bad of ['yesterday', '2026-3-1', 20260308, '']) {
      expect(readProgram({ direction: 'gain', lastCheckIn: bad })).toEqual({ direction: 'gain' })
    }
  })

  it('keeps valid fields next to invalid ones', () => {
    expect(readProgram({ direction: 'maintain', goalWeight: -4, checkInDay: 3 })).toEqual({ direction: 'maintain', checkInDay: 3 })
  })
})

describe('budgetFor', () => {
  it('subtracts 500 kcal a day to lose 1 lb a week', () => {
    expect(budgetFor({ direction: 'lose', weeklyRate: 1 }, 'lb', 2500)).toEqual({ calories: 2000, floored: false })
  })

  it('adds 500 kcal a day to gain 1 lb a week', () => {
    expect(budgetFor({ direction: 'gain', weeklyRate: 1 }, 'lb', 2500).calories).toBe(3000)
  })

  it('keeps expenditure when maintaining, whatever the rate field says', () => {
    expect(budgetFor({ direction: 'maintain', weeklyRate: 2 }, 'lb', 2500).calories).toBe(2500)
  })

  it('treats a missing rate as no change', () => {
    expect(budgetFor({ direction: 'lose' }, 'lb', 2500).calories).toBe(2500)
  })

  it('converts a kg rate to pounds', () => {
    const expected = Math.round(2500 - (0.5 * LB_PER_KG * 3500) / 7)
    expect(budgetFor({ direction: 'lose', weeklyRate: 0.5 }, 'kg', 2500).calories).toBe(expected)
    expect(expected).toBe(1949)
  })

  it('holds the budget at the floor and flags it', () => {
    expect(MIN_BUDGET_KCAL).toBe(1200)
    expect(budgetFor({ direction: 'lose', weeklyRate: 2 }, 'lb', 1500)).toEqual({ calories: 1200, floored: true })
  })

  it('is not floored when the raw budget is exactly 1200', () => {
    expect(budgetFor({ direction: 'lose', weeklyRate: 1 }, 'lb', 1700)).toEqual({ calories: 1200, floored: false })
  })

  it('computes protein from the trend weight and fills carbs with the remainder', () => {
    const b = budgetFor({ direction: 'maintain', proteinPerWeight: 0.8 }, 'lb', 2000, 180)
    expect(b.protein).toBe(144)
    expect(b.fat).toBe(67)
    expect(b.carbs).toBe(205)
  })

  it('never reports negative carbs when protein and fat exceed the budget', () => {
    const b = budgetFor({ direction: 'maintain', proteinPerWeight: 2 }, 'lb', 2000, 400)
    expect(b.protein).toBe(800)
    expect(b.carbs).toBe(0)
  })

  it('omits macros without a protein target or without a trend weight', () => {
    const none = budgetFor({ direction: 'maintain' }, 'lb', 2000, 180)
    expect(none).not.toHaveProperty('protein')
    expect(none).not.toHaveProperty('carbs')
    expect(budgetFor({ direction: 'maintain', proteinPerWeight: 0.8 }, 'lb', 2000)).not.toHaveProperty('protein')
  })
})

describe('goalProgress', () => {
  it('is undefined without a goal weight', () => {
    expect(goalProgress({ direction: 'lose', weeklyRate: 1 }, 180, SUNDAY)).toBeUndefined()
  })

  it('is undefined without a usable trend weight', () => {
    for (const trend of [0, -1, Number.NaN]) expect(goalProgress({ direction: 'lose', goalWeight: 170 }, trend, SUNDAY)).toBeUndefined()
  })

  it('projects the date for a loss at the program rate', () => {
    expect(goalProgress({ direction: 'lose', goalWeight: 170, weeklyRate: 1 }, 180, SUNDAY)).toEqual({ remaining: 10, reached: false, projectedDate: shiftDate(SUNDAY, 70) })
  })

  it('rounds the projected days up', () => {
    // 10 / 0.75 weeks = 13.33 weeks = 93.33 days
    expect(goalProgress({ direction: 'lose', goalWeight: 170, weeklyRate: 0.75 }, 180, SUNDAY)?.projectedDate).toBe(shiftDate(SUNDAY, 94))
  })

  it('projects a gain', () => {
    expect(goalProgress({ direction: 'gain', goalWeight: 190, weeklyRate: 2 }, 180, SUNDAY)).toEqual({ remaining: 10, reached: false, projectedDate: shiftDate(SUNDAY, 35) })
  })

  it('has no projected date without a rate', () => {
    expect(goalProgress({ direction: 'lose', goalWeight: 170 }, 180, SUNDAY)).toEqual({ remaining: 10, reached: false })
  })

  it('is reached exactly at the goal and past it, for loss and gain', () => {
    expect(goalProgress({ direction: 'lose', goalWeight: 170, weeklyRate: 1 }, 170, SUNDAY)).toEqual({ remaining: 0, reached: true })
    expect(goalProgress({ direction: 'lose', goalWeight: 170, weeklyRate: 1 }, 165, SUNDAY)).toEqual({ remaining: 0, reached: true })
    expect(goalProgress({ direction: 'gain', goalWeight: 190, weeklyRate: 1 }, 195, SUNDAY)).toEqual({ remaining: 0, reached: true })
  })

  it('gain is reached when already above the goal and not reached below it', () => {
    expect(goalProgress({ direction: 'gain', goalWeight: 170, weeklyRate: 1 }, 180, SUNDAY)?.reached).toBe(true)
    expect(goalProgress({ direction: 'gain', goalWeight: 190, weeklyRate: 1 }, 180, SUNDAY)?.reached).toBe(false)
  })

  it('treats maintain as reached within half a unit and gives no date', () => {
    expect(goalProgress({ direction: 'maintain', goalWeight: 180 }, 180.4, SUNDAY)).toEqual({ remaining: 0, reached: true })
    expect(goalProgress({ direction: 'maintain', goalWeight: 180, weeklyRate: 1 }, 182, SUNDAY)).toEqual({ remaining: 2, reached: false })
  })
})

describe('lastCheckInDate', () => {
  it('is today when today is the check-in weekday', () => {
    expect(lastCheckInDate(SUNDAY, 0)).toBe(SUNDAY)
  })

  it('is the most recent matching weekday before today', () => {
    expect(lastCheckInDate(WEDNESDAY, 0)).toBe(SUNDAY)
    expect(lastCheckInDate('2026-03-14', 0)).toBe('2026-03-08')
    expect(lastCheckInDate(WEDNESDAY, 3)).toBe(WEDNESDAY)
    expect(lastCheckInDate(WEDNESDAY, 4)).toBe('2026-03-12')
  })

  it('crosses a month boundary', () => {
    expect(lastCheckInDate('2026-03-02', 6)).toBe('2026-02-28')
  })
})

describe('isCheckInDue', () => {
  const base: Program = { direction: 'lose', checkInDay: 0 }

  it('is due when the user has never checked in', () => {
    expect(isCheckInDue(base, WEDNESDAY)).toBe(true)
  })

  it('is due once the check-in weekday has passed since the last one', () => {
    expect(isCheckInDue({ ...base, lastCheckIn: '2026-03-08' }, WEDNESDAY)).toBe(true)
  })

  it('is due on the check-in weekday itself', () => {
    expect(isCheckInDue({ ...base, lastCheckIn: '2026-03-08' }, SUNDAY)).toBe(true)
  })

  it('is not due the same week after the last check-in', () => {
    expect(isCheckInDue({ ...base, lastCheckIn: SUNDAY }, WEDNESDAY)).toBe(false)
    expect(isCheckInDue({ ...base, lastCheckIn: SUNDAY }, SUNDAY)).toBe(false)
  })

  it('is not due the day before the next check-in weekday', () => {
    expect(isCheckInDue({ ...base, lastCheckIn: '2026-03-08' }, '2026-03-14')).toBe(false)
  })

  it('is false without a direction or without a check-in day', () => {
    expect(isCheckInDue({ checkInDay: 0 }, WEDNESDAY)).toBe(false)
    expect(isCheckInDue({ direction: 'lose' }, WEDNESDAY)).toBe(false)
    expect(isCheckInDue({}, WEDNESDAY)).toBe(false)
  })
})

describe('buildCheckIn', () => {
  const WEEK_END = SUNDAY
  const day = (offset: number) => shiftDate(WEEK_END, -offset)
  let seq = 0
  const eaten = (date: string, calories: number, extra: Partial<DiaryEntry> = {}): DiaryEntry =>
    ({ id: `e-${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp, ...extra })
  const weigh = (date: string, weight: number): WeightEntry => ({ id: `w-${date}`, date, weight, unit: 'lb', createdAt: stamp })
  const settings = (program: unknown, calories?: number): Settings =>
    ({ id: 'profile', goals: { weightUnit: 'lb', ...(calories !== undefined ? { calories } : {}) }, program, updatedAt: stamp }) as Settings
  const lose: Program = { direction: 'lose', weeklyRate: 1, checkInDay: 0 }
  // 20 steady days at 2300 kcal with flat weights: expenditure 2300, so a 1 lb/week loss gives a 1800 budget.
  const steadyEntries = Array.from({ length: 20 }, (_, i) => eaten(day(i), 2300))
  const steadyWeights = [20, 15, 10, 5, 0].map((o) => weigh(day(o), 180))

  it('is undefined without a program, a direction or a check-in day', () => {
    expect(buildCheckIn([], [], undefined, WEDNESDAY)).toBeUndefined()
    expect(buildCheckIn([], [], settings(undefined), WEDNESDAY)).toBeUndefined()
    expect(buildCheckIn([], [], settings({ checkInDay: 0 }), WEDNESDAY)).toBeUndefined()
    expect(buildCheckIn([], [], settings({ direction: 'lose' }), WEDNESDAY)).toBeUndefined()
    expect(buildCheckIn([], [], settings('junk'), WEDNESDAY)).toBeUndefined()
  })

  it('reviews the week ending on the most recent check-in weekday', () => {
    expect(buildCheckIn([], [], settings(lose), WEDNESDAY)?.weekEnding).toBe(WEEK_END)
  })

  it('counts only eaten days within the seven days ending on the check-in date', () => {
    const entries = [
      eaten(day(0), 2000), eaten(day(0), 500), // two entries, one day
      eaten(day(3), 2000),
      eaten(day(6), 2000), // first day of the week
      eaten(day(7), 2000), // one day too early
      eaten(shiftDate(WEEK_END, 1), 2000), // after the check-in date
      eaten(day(2), 2000, { planned: true }), // planned, not eaten
    ]
    const review = buildCheckIn(entries, [], settings(lose), WEDNESDAY)
    expect(review?.daysLogged).toBe(3)
    expect(review?.avgIntake).toBe(Math.round((2500 + 2000 + 2000) / 3))
  })

  it('has no average intake with nothing logged and a not-enough-days headline', () => {
    const review = buildCheckIn([], [], settings(lose), WEDNESDAY)
    expect(review?.daysLogged).toBe(0)
    expect(review?.avgIntake).toBeUndefined()
    expect(review?.headline).toMatch(/Not enough logged days/)
  })

  it('uses the not-enough-days headline at 3 days but not at 4', () => {
    const three = [0, 1, 2].map((o) => eaten(day(o), 2000))
    const four = [0, 1, 2, 3].map((o) => eaten(day(o), 2000))
    expect(buildCheckIn(three, [], settings(lose), WEDNESDAY)?.headline).toMatch(/Not enough logged days/)
    expect(buildCheckIn(four, [], settings(lose), WEDNESDAY)?.headline).toMatch(/until there is enough data/)
  })

  it('says the budget falls when the new budget is lower than the current one', () => {
    const review = buildCheckIn(steadyEntries, steadyWeights, settings(lose, 2000), WEDNESDAY)
    expect(review?.expenditure).toMatchObject({ kind: 'ok', kcalPerDay: 2300 })
    expect(review?.newBudget?.calories).toBe(1800)
    expect(review?.currentBudget).toBe(2000)
    expect(review?.headline).toBe('The budget falls by 200 kcal.')
  })

  it('says the budget rises when the new budget is higher than the current one', () => {
    expect(buildCheckIn(steadyEntries, steadyWeights, settings(lose, 1500), WEDNESDAY)?.headline).toBe('The budget rises by 300 kcal.')
  })

  it('says on track when the new budget equals the current one', () => {
    expect(buildCheckIn(steadyEntries, steadyWeights, settings(lose, 1800), WEDNESDAY)?.headline).toMatch(/On track/)
  })

  it('says a budget is ready when none is set yet', () => {
    const review = buildCheckIn(steadyEntries, steadyWeights, settings(lose), WEDNESDAY)
    expect(review?.currentBudget).toBeUndefined()
    expect(review?.headline).toBe('A budget is ready to set from your program.')
  })

  it('reports the trend change across the week when there are weigh-ins on both sides', () => {
    const weights = [weigh(day(10), 180), weigh(day(0), 180)]
    expect(buildCheckIn(steadyEntries, weights, settings(lose), WEDNESDAY)?.trendChange).toBeCloseTo(0, 10)
    expect(buildCheckIn(steadyEntries, [weigh(day(0), 180)], settings(lose), WEDNESDAY)?.trendChange).toBeUndefined()
  })

  it('ignores junk program fields rather than throwing', () => {
    expect(buildCheckIn([], [], settings({ direction: 'fly', checkInDay: 9 }), WEDNESDAY)).toBeUndefined()
  })
})
