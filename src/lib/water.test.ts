import { describe, expect, it } from 'vitest'
import { adjustedWater, formatWater, waterStep } from './water'

describe('waterStep', () => {
  it('is a 237 ml glass labelled 8 fl oz for pound users', () => {
    expect(waterStep('lb')).toEqual({ ml: 237, label: '8 fl oz' })
  })
  it('is a 250 ml glass for kilogram users', () => {
    expect(waterStep('kg')).toEqual({ ml: 250, label: '250 ml' })
  })
})

describe('formatWater', () => {
  it.each([[0], [Number.NaN], [-50], [Number.POSITIVE_INFINITY]])('shows zero fl oz for %s', (ml) => {
    expect(formatWater(ml, 'lb')).toBe('0 fl oz')
  })
  it.each([[0], [Number.NaN], [-50]])('shows zero ml for %s in kg units', (ml) => {
    expect(formatWater(ml, 'kg')).toBe('0 ml')
  })
  it('shows one glass as 8 fl oz', () => {
    expect(formatWater(237, 'lb')).toBe('8 fl oz')
  })
  it('stays in ml just below a litre', () => {
    expect(formatWater(999, 'kg')).toBe('999 ml')
  })
  it('switches to litres at exactly 1000 ml', () => {
    expect(formatWater(1000, 'kg')).toBe('1 L')
  })
  it('shows litres to two decimals', () => {
    expect(formatWater(1750, 'kg')).toBe('1.75 L')
  })
})

describe('adjustedWater', () => {
  it('adds a positive change', () => {
    expect(adjustedWater(237, 237)).toBe(474)
  })
  it('never goes below zero', () => {
    expect(adjustedWater(100, -250)).toBe(0)
  })
  it('stops at exactly zero', () => {
    expect(adjustedWater(250, -250)).toBe(0)
  })
  it('rounds to whole millilitres', () => {
    expect(adjustedWater(10.4, 0.2)).toBe(11)
  })
  it('treats a NaN current total as zero', () => {
    expect(adjustedWater(Number.NaN, 237)).toBe(237)
  })
})
