import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueReminders, markFired, readReminders, wasFired } from './reminders'

const at = (hours: number, minutes: number) => new Date(2026, 5, 15, hours, minutes, 0)
const never = () => false
const open = { loggedFoodToday: false, weighedToday: false }

describe('readReminders', () => {
  it.each([[undefined], [null], ['text'], [7], [[]], [['logFood']]])('returns nothing for %s', (value) => {
    expect(readReminders(value)).toEqual({})
  })
  it('drops unknown kinds', () => {
    expect(readReminders({ logFood: '12:00', hydrate: '09:00' })).toEqual({ logFood: '12:00' })
  })
  it.each([['25:00'], ['7:00'], ['12:60'], ['noon'], [1200], [null]])('drops the bad time %s', (time) => {
    expect(readReminders({ logFood: time })).toEqual({})
  })
  it('keeps valid HH:MM times', () => {
    expect(readReminders({ logFood: '00:00', weighIn: '23:59' })).toEqual({ logFood: '00:00', weighIn: '23:59' })
  })
})

describe('dueReminders', () => {
  const times = { logFood: '12:00' }
  it('is not due before its time', () => {
    expect(dueReminders(times, at(11, 59), never, open)).toEqual([])
  })
  it('is due exactly at its time', () => {
    expect(dueReminders(times, at(12, 0), never, open)).toEqual(['logFood'])
  })
  it('is still due exactly 60 minutes after', () => {
    expect(dueReminders(times, at(13, 0), never, open)).toEqual(['logFood'])
  })
  it('is not due 61 minutes after', () => {
    expect(dueReminders(times, at(13, 1), never, open)).toEqual([])
  })
  it('is not due when no time is set', () => {
    expect(dueReminders({}, at(12, 0), never, open)).toEqual([])
  })
  it('is not due when already fired', () => {
    expect(dueReminders(times, at(12, 5), (kind) => kind === 'logFood', open)).toEqual([])
  })
  it('suppresses the food reminder once food is logged', () => {
    expect(dueReminders(times, at(12, 5), never, { loggedFoodToday: true, weighedToday: false })).toEqual([])
  })
  it('does not suppress the food reminder because of a weigh-in', () => {
    expect(dueReminders(times, at(12, 5), never, { loggedFoodToday: false, weighedToday: true })).toEqual(['logFood'])
  })
  it('suppresses the weigh-in once weight is logged, but not the food reminder', () => {
    const both = { logFood: '07:00', weighIn: '07:00' }
    expect(dueReminders(both, at(7, 5), never, { loggedFoodToday: false, weighedToday: true })).toEqual(['logFood'])
  })
  it('orders results by REMINDERS, not by key order', () => {
    expect(dueReminders({ weighIn: '07:00', logFood: '07:00' }, at(7, 10), never, open)).toEqual(['logFood', 'weighIn'])
  })
})

describe('wasFired and markFired', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('is not fired on a first run', () => {
    expect(wasFired('logFood', '2026-06-15')).toBe(false)
  })
  it('round trips for the same kind and date', () => {
    markFired('logFood', '2026-06-15')
    expect(wasFired('logFood', '2026-06-15')).toBe(true)
  })
  it('keys by kind', () => {
    markFired('logFood', '2026-06-15')
    expect(wasFired('weighIn', '2026-06-15')).toBe(false)
  })
  it('keys by date, so the next day fires again', () => {
    markFired('logFood', '2026-06-15')
    expect(wasFired('logFood', '2026-06-16')).toBe(false)
  })
  it('does not throw when localStorage throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => markFired('logFood', '2026-06-15')).not.toThrow()
  })
  it('reports not fired when localStorage throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(wasFired('logFood', '2026-06-15')).toBe(false)
  })
})
