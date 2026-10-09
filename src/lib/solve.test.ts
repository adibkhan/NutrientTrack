import { describe, expect, it } from 'vitest'
import { solveAmount } from './solve'

describe('solveAmount', () => {
  it('divides_target_by_per_unit', () => {
    expect(solveAmount(30, 10)).toBe(3)
  })
  it('rounds_to_two_decimals_by_default', () => {
    expect(solveAmount(10, 3)).toBe(3.33)
    expect(solveAmount(20, 3)).toBe(6.67)
  })
  it('rounds_to_the_requested_digits', () => {
    expect(solveAmount(10, 3, 1)).toBe(3.3)
    expect(solveAmount(10, 3, 0)).toBe(3)
    expect(solveAmount(10, 3, 4)).toBe(3.3333)
  })
  it.each([0, -5, NaN, Infinity, -Infinity])('returns_undefined_for_target_%s', (target) => {
    expect(solveAmount(target, 10)).toBeUndefined()
  })
  it.each([0, -2, NaN, Infinity, -Infinity])('returns_undefined_for_per_unit_%s', (perUnit) => {
    expect(solveAmount(30, perUnit)).toBeUndefined()
  })
  it('returns_undefined_when_the_answer_rounds_to_zero', () => {
    expect(solveAmount(0.001, 100)).toBeUndefined()
    expect(solveAmount(1, 1000, 1)).toBeUndefined()
  })
  it('handles_a_tiny_per_unit', () => {
    expect(solveAmount(30, 0.01)).toBe(3000)
  })
  // KNOWN BUG, left failing on purpose: target / perUnit * 10**digits overflows to Infinity and is returned as an amount.
  // Reachable by typing 1e308 into "Target amount" for a food with 0.01 per unit.
  it('never_returns_a_non_finite_amount', () => {
    expect(solveAmount(1e308, 0.01)).toBeUndefined()
    expect(solveAmount(1e300, 1e-300)).toBeUndefined()
  })
})
