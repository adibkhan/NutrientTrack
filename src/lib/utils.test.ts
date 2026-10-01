import { describe, expect, it } from 'vitest'
import { formatClockTime, mealForTime } from './utils'

describe('mealForTime', () => {
  const cases: Array<[string, string]> = [
    ['05:00', 'breakfast'], ['08:15', 'breakfast'], ['10:59', 'breakfast'],
    ['11:00', 'lunch'], ['12:30', 'lunch'], ['14:59', 'lunch'],
    ['15:00', 'snack'], ['16:59', 'snack'],
    ['17:00', 'dinner'], ['19:30', 'dinner'], ['21:59', 'dinner'],
    ['22:00', 'snack'], ['23:59', 'snack'], ['00:00', 'snack'], ['04:59', 'snack'],
  ]
  it.each(cases)('maps %s to %s', (time, meal) => {
    expect(mealForTime(time)).toBe(meal)
  })

  it.each([['', 'empty'], ['8:00', 'unpadded hour'], ['24:00', 'hour out of range'], ['12:60', 'minute out of range'], ['abc', 'text'], ['08:15:30', 'with seconds'], [' 08:15', 'leading space']])(
    'returns other for unreadable time %j (%s)', (time) => {
      expect(mealForTime(time)).toBe('other')
    })
})

describe('formatClockTime', () => {
  const expected = (h: number, m: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2020, 0, 1, h, m))

  it.each([['07:40', 7, 40], ['00:05', 0, 5], ['23:59', 23, 59], ['12:00', 12, 0]])('formats %s as a locale clock time', (time, h, m) => {
    expect(formatClockTime(time)).toBe(expected(h as number, m as number))
  })

  it('formats midnight and the last minute rather than passing them through', () => {
    expect(formatClockTime('00:05')).not.toBe('00:05')
    expect(formatClockTime('23:59')).not.toBe('23:59')
  })

  it.each([[''], ['8:00'], ['24:00'], ['12:60'], ['abc'], ['08:15:30'], [' 08:15']])('returns unreadable value %j unchanged', (time) => {
    expect(formatClockTime(time)).toBe(time)
  })
})
