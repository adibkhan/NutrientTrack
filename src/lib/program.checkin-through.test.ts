// The weekly check-in reviews finished days only, and answering it on the check-in day stops it being due.
import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Program, Settings } from '../types'
import { MIN_CHECKIN_DAYS, buildCheckIn, isCheckInDue } from './program'
import { shiftDate } from './utils'

const stamp = '2026-01-01T00:00:00.000Z'
const SUNDAY = '2026-03-15' // weekday 0
const WEDNESDAY = '2026-03-18'
const lose: Program = { direction: 'lose', weeklyRate: 1, checkInDay: 0 }
let seq = 0
const eaten = (date: string, calories: number): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp })
const settings = (program: unknown): Settings => ({ id: 'profile', goals: { weightUnit: 'lb', calories: 2000 }, program, updatedAt: stamp }) as Settings

describe('buildCheckIn on the check-in day itself', () => {
  it('ends the week at yesterday and keeps the check-in day as dueDate', () => {
    const review = buildCheckIn([], [], settings(lose), SUNDAY)
    expect(review?.weekEnding).toBe(shiftDate(SUNDAY, -1))
    expect(review?.dueDate).toBe(SUNDAY)
  })

  it('does not count an entry dated today in daysLogged or avgIntake', () => {
    const entries = [eaten(shiftDate(SUNDAY, -1), 2000), eaten(shiftDate(SUNDAY, -2), 2000), eaten(SUNDAY, 400)]
    const review = buildCheckIn(entries, [], settings(lose), SUNDAY)
    expect(review?.daysLogged).toBe(2)
    expect(review?.avgIntake).toBe(2000)
  })

  it('counts the seven finished days before the check-in day, including the one 7 days back', () => {
    const entries = [1, 2, 3, 4, 5, 6, 7].map((o) => eaten(shiftDate(SUNDAY, -o), 2000))
    expect(buildCheckIn(entries, [], settings(lose), SUNDAY)?.daysLogged).toBe(7)
    expect(buildCheckIn([...entries, eaten(shiftDate(SUNDAY, -8), 2000)], [], settings(lose), SUNDAY)?.daysLogged).toBe(7)
  })

  it('stops being due once lastCheckIn is the review dueDate (the old weekEnding would leave it due)', () => {
    const review = buildCheckIn([], [], settings(lose), SUNDAY)!
    expect(isCheckInDue({ ...lose, lastCheckIn: review.dueDate }, SUNDAY)).toBe(false)
    expect(isCheckInDue({ ...lose, lastCheckIn: review.weekEnding }, SUNDAY)).toBe(true)
  })
})

describe('buildCheckIn on other days', () => {
  it('has weekEnding equal to dueDate, the most recent check-in day', () => {
    const review = buildCheckIn([], [], settings(lose), WEDNESDAY)
    expect(review?.weekEnding).toBe(SUNDAY)
    expect(review?.dueDate).toBe(SUNDAY)
  })

  it('counts the check-in day itself when it is already finished', () => {
    const review = buildCheckIn([eaten(SUNDAY, 2000)], [], settings(lose), WEDNESDAY)
    expect(review?.daysLogged).toBe(1)
  })
})

describe('MIN_CHECKIN_DAYS', () => {
  it('is four', () => {
    expect(MIN_CHECKIN_DAYS).toBe(4)
  })
})
