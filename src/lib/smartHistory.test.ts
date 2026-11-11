import { describe, expect, it } from 'vitest'
import type { DiaryEntry } from '../types'
import { MAX_USUAL, smartHistory, usualKey, usualLabel } from './smartHistory'

// Wednesday 10 June 2026. Every clock below is built from local fields, so nothing depends on the real time or the time zone.
const at = (hour: number, minute = 0, day = 10) => new Date(2026, 5, day, hour, minute, 0)
const pad = (n: number) => String(n).padStart(2, '0')
/** An ISO calendar date `back` days before 10 June 2026, computed on the calendar (no time zone involved). */
const daysAgo = (back: number): string => {
  const d = new Date(Date.UTC(2026, 5, 10 - back))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
let counter = 0
const entry = (name: string, back: number, time: string | undefined, extra: Partial<DiaryEntry> = {}): DiaryEntry => {
  counter += 1
  return {
    id: `e${String(counter).padStart(4, '0')}`, name, meal: 'lunch', date: daysAgo(back), ...(time ? { time } : {}),
    calories: 200, protein: 10, carbs: 20, fat: 5,
    createdAt: `2026-01-01T00:00:00.000Z`, updatedAt: `2026-01-01T00:${pad(Math.floor(counter / 60) % 60)}:${pad(counter % 60)}.000Z`, ...extra,
  }
}
const names = (list: DiaryEntry[]) => list.map((item) => item.name)
/** Padding so a small scenario clears the five-entry minimum without scoring. */
const filler = (): DiaryEntry[] => [0, 1, 2, 3, 4].map((i) => entry(`Night snack ${i}`, 3 + i, '23:30', { meal: 'snack' }))

describe('smartHistory', () => {
  it('returns nothing with fewer than 5 past entries', () => {
    const four = [1, 2, 3, 4].map((back) => entry('Oats', back, '12:10'))
    expect(smartHistory(four, at(12, 15))).toEqual([])
    expect(names(smartHistory([...four, entry('Oats', 5, '12:10')], at(12, 15)))).toEqual(['Oats'])
  })

  it('does not count planned entries toward the minimum', () => {
    const list = [1, 2, 3, 4].map((back) => entry('Oats', back, '12:10'))
    list.push(entry('Oats', 5, '12:10', { planned: true }))
    expect(smartHistory(list, at(12, 15))).toEqual([])
  })

  it('ranks by how often and how recently a food is logged around now', () => {
    const list = [
      ...[1, 2, 3, 4].map((back) => entry('Sandwich', back, '12:30')),
      entry('Salad', 1, '12:30'),
      entry('Pizza', 50, '12:30'),
      entry('Pizza', 51, '12:30'),
      ...filler(),
    ]
    expect(names(smartHistory(list, at(12, 15)))).toEqual(['Sandwich', 'Salad', 'Pizza'])
  })

  it('halves an entry every 14 days: one fresh log beats two logs from 28 days back', () => {
    const list = [entry('Fresh', 1, '12:00'), entry('Old', 29, '12:00'), entry('Old', 30, '12:00'), ...filler()]
    expect(names(smartHistory(list, at(12, 0)))).toEqual(['Fresh', 'Old'])
  })

  it('ignores entries more than 90 minutes from now and prefers the closer one', () => {
    const list = [entry('Near', 2, '12:20'), entry('Edge', 2, '13:45'), entry('Far', 2, '13:46'), entry('Evening', 2, '19:00'), ...filler()]
    expect(names(smartHistory(list, at(12, 15)))).toEqual(['Near', 'Edge'])
  })

  it('wraps the time window around midnight', () => {
    const list = [entry('Late', 2, '23:40'), entry('Early', 2, '00:20'), entry('Noon', 2, '12:00'), ...[1, 2, 3].map((i) => entry(`x${i}`, 5, '12:00'))]
    expect(names(smartHistory(list, at(0, 5))).sort()).toEqual(['Early', 'Late'])
  })

  it('uses the meal for entries without a time, only when it is the clock meal', () => {
    const list = [
      entry('Toast', 2, undefined, { meal: 'breakfast' }),
      entry('Coffee', 2, undefined, { meal: 'breakfast' }),
      entry('Steak', 2, undefined, { meal: 'dinner' }),
      ...filler(),
    ]
    expect(names(smartHistory(list, at(8, 0))).sort()).toEqual(['Coffee', 'Toast'])
    expect(names(smartHistory(list, at(19, 0)))).toEqual(['Steak'])
  })

  it('weighs a timed entry above a meal-only one from the same day', () => {
    const list = [entry('Meal only', 2, undefined, { meal: 'lunch' }), entry('Timed', 2, '12:15'), ...filler()]
    expect(names(smartHistory(list, at(12, 15)))).toEqual(['Timed', 'Meal only'])
  })

  it('drops planned entries, future days and anything older than 60 days', () => {
    const list = [
      entry('Planned', 1, '12:00', { planned: true }),
      entry('Tomorrow', -1, '12:00'),
      entry('Ancient', 61, '12:00'),
      entry('Edge of window', 60, '12:00'),
      ...filler(),
    ]
    expect(names(smartHistory(list, at(12, 0)))).toEqual(['Edge of window'])
  })

  it('merges entries with the same name and calories, but not different calories', () => {
    const list = [
      entry('Latte', 1, '12:00', { calories: 120 }),
      entry('latte ', 2, '12:00', { calories: 120.2 }),
      entry('Latte', 3, '12:00', { calories: 180 }),
      ...filler(),
    ]
    const result = smartHistory(list, at(12, 0))
    expect(result).toHaveLength(2)
    expect(result[0].calories).toBe(120.2)
    expect(usualKey(result[0])).toBe('latte|120')
    expect(result[1].calories).toBe(180)
  })

  it('shows the latest logged amount for a merged food', () => {
    const older = entry('Latte', 2, '12:00', { grams: 200, updatedAt: '2026-05-01T00:00:00.000Z' })
    const newer = entry('Latte', 1, '12:00', { grams: 240, updatedAt: '2026-06-01T00:00:00.000Z' })
    expect(smartHistory([older, newer, ...filler()], at(12, 0))[0].id).toBe(newer.id)
  })

  it('gives a small boost to the same weekday, but not enough to beat a much fresher entry', () => {
    // 10 June 2026 is a Wednesday: 7 days back is a Wednesday, 6 days back a Tuesday, 3 days back a Sunday.
    const tuesday = entry('Tuesday food', 6, '12:00')
    const wednesday = entry('Wednesday food', 7, '12:00')
    expect(names(smartHistory([tuesday, wednesday, ...filler()], at(12, 0)))).toEqual(['Wednesday food', 'Tuesday food'])
    const sunday = entry('Sunday food', 3, '12:00')
    expect(names(smartHistory([sunday, wednesday, ...filler()], at(12, 0)))).toEqual(['Sunday food', 'Wednesday food'])
  })

  it('caps the list at 12', () => {
    const list = Array.from({ length: 20 }, (_, i) => entry(`Food ${String(i).padStart(2, '0')}`, 1 + (i % 5), '12:00'))
    expect(smartHistory(list, at(12, 0))).toHaveLength(MAX_USUAL)
    expect(smartHistory(list, at(12, 0), 3)).toHaveLength(3)
  })

  it('breaks ties the same way whatever order the entries arrive in', () => {
    const list = ['Pear', 'Apple', 'Fig', 'Date', 'Cherry', 'Banana'].map((name) => entry(name, 2, '12:00', { updatedAt: '2026-05-05T00:00:00.000Z' }))
    const forward = names(smartHistory(list, at(12, 0)))
    expect(forward).toEqual(['Apple', 'Banana', 'Cherry', 'Date', 'Fig', 'Pear'])
    expect(names(smartHistory([...list].reverse(), at(12, 0)))).toEqual(forward)
    expect(names(smartHistory([...list.slice(3), ...list.slice(0, 3)], at(12, 0)))).toEqual(forward)
  })

  it('ranks the same history differently at breakfast and at dinner', () => {
    const list = [
      ...[1, 2, 3].map((back) => entry('Oatmeal', back, '08:00', { meal: 'breakfast' })),
      ...[1, 2, 3].map((back) => entry('Pasta', back, '19:00', { meal: 'dinner' })),
    ]
    expect(names(smartHistory(list, at(8, 10)))).toEqual(['Oatmeal'])
    expect(names(smartHistory(list, at(19, 10)))).toEqual(['Pasta'])
  })

  it('does not change with the real time of day: the same fake clock gives the same answer', () => {
    const list = [...[1, 2, 3].map((back) => entry('Oatmeal', back, '08:00')), ...filler()]
    expect(smartHistory(list, at(8, 0))).toEqual(smartHistory(list, at(8, 0)))
  })
})

describe('smartHistory with a chosen meal', () => {
  const week = [1, 2, 3].flatMap((back) => [entry('Oatmeal', back, '08:00', { meal: 'breakfast' }), entry('Pasta', back, '19:00', { meal: 'dinner' }), entry('Snack bar', back, undefined, { meal: 'snack' })])

  it('ignores the clock and ranks the chosen meal', () => {
    expect(names(smartHistory(week, at(8, 10), 12, 'dinner'))).toEqual(['Pasta'])
    expect(names(smartHistory(week, at(19, 10), 12, 'breakfast'))).toEqual(['Oatmeal'])
    expect(names(smartHistory(week, at(12, 0), 12, 'snack'))).toEqual(['Snack bar'])
  })

  it('uses the clock when no meal is chosen', () => {
    expect(names(smartHistory(week, at(8, 10)))).toEqual(['Oatmeal'])
  })

  it('returns nothing for a meal with no history', () => {
    expect(smartHistory(week, at(8, 10), 12, 'lunch')).toEqual([])
  })
})

describe('usualLabel', () => {
  it('names the chosen meal instead of the clock', () => {
    expect(usualLabel(at(8, 0), 'dinner')).toBe('Usual for Dinner')
    expect(usualLabel(at(8, 0), 'snack')).toBe('Usual for Snacks')
    expect(usualLabel(at(8, 0), 'other')).toBe('Usual for now')
  })

  it.each([[8, 0, 'Usual for Breakfast'], [10, 59, 'Usual for Breakfast'], [12, 30, 'Usual for Lunch'], [15, 30, 'Usual for now'], [19, 0, 'Usual for Dinner'], [23, 0, 'Usual for now'], [2, 0, 'Usual for now']])('%i:%i reads %s', (hour, minute, label) => {
    expect(usualLabel(at(hour, minute))).toBe(label)
  })
})
