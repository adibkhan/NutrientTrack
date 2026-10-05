import { describe, expect, it } from 'vitest'
import { convertProgramUnit, describeGoalProgress } from './program'

const lbProgram = { direction: 'lose', goalWeight: 170, weeklyRate: 1, proteinPerWeight: 0.8, checkInDay: 3, lastCheckIn: '2026-03-01', futureProgramField: { keep: 'me' } }

describe('convertProgramUnit', () => {
  it('converts lb to kg with goal at 1 decimal, rate at 2 and protein per kg', () => {
    const out = convertProgramUnit(lbProgram, 'lb', 'kg')
    expect(out.goalWeight).toBe(77.1)
    expect(out.weeklyRate).toBe(0.45)
    expect(out.proteinPerWeight).toBe(1.76)
  })

  it('converts kg to lb with the inverse factors', () => {
    const out = convertProgramUnit({ goalWeight: 77.1, weeklyRate: 0.45, proteinPerWeight: 1.76 }, 'kg', 'lb')
    expect(out.goalWeight).toBe(170) // 77.1 * 2.2046 = 169.98
    expect(out.weeklyRate).toBe(0.99)
    expect(out.proteinPerWeight).toBe(0.8)
  })

  it('returns the same object when the unit does not change', () => {
    expect(convertProgramUnit(lbProgram, 'lb', 'lb')).toBe(lbProgram)
    expect(convertProgramUnit(lbProgram, 'kg', 'kg')).toBe(lbProgram)
  })

  it('keeps unknown fields, direction, check-in day and last check-in untouched and does not mutate the input', () => {
    const before = JSON.stringify(lbProgram)
    const out = convertProgramUnit(lbProgram, 'lb', 'kg')
    expect(out).toMatchObject({ direction: 'lose', checkInDay: 3, lastCheckIn: '2026-03-01', futureProgramField: { keep: 'me' } })
    expect(JSON.stringify(lbProgram)).toBe(before)
  })

  it('does not add fields that were not recorded', () => {
    const out = convertProgramUnit({ direction: 'maintain' }, 'lb', 'kg')
    expect(out).toEqual({ direction: 'maintain' })
    expect('goalWeight' in out).toBe(false)
  })

  it.each([['zero', 0], ['negative', -5], ['NaN', NaN], ['Infinity', Infinity], ['a numeric string', '170'], ['null', null], ['an object', {}]])(
    'leaves a %s value alone',
    (_label, value) => {
      const out = convertProgramUnit({ goalWeight: value, weeklyRate: value, proteinPerWeight: value }, 'lb', 'kg') as Record<string, unknown>
      for (const key of ['goalWeight', 'weeklyRate', 'proteinPerWeight']) expect(out[key]).toEqual(value)
    },
  )

  it.each([['a string', 'x'], ['null', null], ['undefined', undefined], ['an array', [170, 1]]])('returns %s unchanged', (_label, value) => {
    expect(convertProgramUnit(value, 'lb', 'kg')).toBe(value)
  })

  it('round trips lb to kg to lb within rounding', () => {
    const there = convertProgramUnit(lbProgram, 'lb', 'kg')
    const back = convertProgramUnit(there, 'kg', 'lb')
    expect(Math.abs(back.goalWeight - 170)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(back.weeklyRate - 1)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(back.proteinPerWeight - 0.8)).toBeLessThanOrEqual(0.01)
  })
})

describe('describeGoalProgress', () => {
  it('says Reached when the goal is reached', () => {
    expect(describeGoalProgress({ remaining: 0, reached: true }, 'lb')).toBe('Reached')
  })

  it('shows the remaining amount rounded to a tenth with the unit when there is no projected date', () => {
    expect(describeGoalProgress({ remaining: 10.44, reached: false }, 'lb')).toBe('10.4 lb')
    expect(describeGoalProgress({ remaining: 4.5, reached: false }, 'kg')).toBe('4.5 kg')
  })

  it('adds the projected date with its year when there is one', () => {
    const text = describeGoalProgress({ remaining: 10.44, reached: false, projectedDate: '2026-12-24' }, 'lb')
    expect(text).toContain('10.4 lb')
    expect(text).toContain(' · by ')
    expect(text).toContain('2026')
  })
})
