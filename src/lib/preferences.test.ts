import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, macroShares, readPreferences, THEME_STORAGE_KEY } from './preferences'

describe('readPreferences', () => {
  it.each([null, undefined, [], 'dark', 7, {}])('returns defaults for %j', (value) => {
    expect(readPreferences(value)).toEqual({ theme: 'system', macroDisplay: 'grams' })
  })

  it('keeps valid values', () => {
    expect(readPreferences({ theme: 'dark', macroDisplay: 'percent' })).toEqual({ theme: 'dark', macroDisplay: 'percent' })
    expect(readPreferences({ theme: 'light' })).toEqual({ theme: 'light', macroDisplay: 'grams' })
  })

  it('falls back per field for junk values', () => {
    expect(readPreferences({ theme: 'sepia', macroDisplay: 42 })).toEqual({ theme: 'system', macroDisplay: 'grams' })
    expect(readPreferences({ theme: 'DARK', macroDisplay: 'percent' })).toEqual({ theme: 'system', macroDisplay: 'percent' })
  })

  it('ignores unknown extra keys', () => {
    expect(readPreferences({ theme: 'dark', fontScale: 3 })).toEqual({ theme: 'dark', macroDisplay: 'grams' })
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('sets the attribute and mirrors to localStorage for dark and light', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('mirrors under the key nutrienttrack-theme', () => {
    expect(THEME_STORAGE_KEY).toBe('nutrienttrack-theme')
  })

  it('removes the attribute and the mirror for system', () => {
    applyTheme('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('is idempotent when applied twice in a row', () => {
    applyTheme('dark')
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('still sets the attribute and does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => applyTheme('dark')).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(() => applyTheme('system')).not.toThrow()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('macroShares', () => {
  it('returns null when all macros are zero', () => {
    expect(macroShares({ protein: 0, carbs: 0, fat: 0 })).toBeNull()
  })

  it('returns null for a negative total', () => {
    expect(macroShares({ protein: -1, carbs: 0, fat: 0 })).toBeNull()
  })

  it('gives 100 percent to a single macro', () => {
    expect(macroShares({ protein: 10, carbs: 0, fat: 0 })).toEqual({ protein: 100, carbs: 0, fat: 0 })
  })

  it('uses 4/4/9 kcal per gram', () => {
    // 25g protein = 100 kcal, 25g carbs = 100 kcal, 200/9 g fat = 200 kcal
    const s = macroShares({ protein: 25, carbs: 25, fat: 200 / 9 })!
    expect(s.protein).toBeCloseTo(25)
    expect(s.carbs).toBeCloseTo(25)
    expect(s.fat).toBeCloseTo(50)
  })

  it('weights fat 9 against protein 4 for equal grams', () => {
    const s = macroShares({ protein: 10, carbs: 0, fat: 10 })!
    expect(s.protein).toBeCloseTo((40 / 130) * 100)
    expect(s.fat).toBeCloseTo((90 / 130) * 100)
  })

  it('shares sum to 100', () => {
    const s = macroShares({ protein: 33.3, carbs: 71.2, fat: 12.9 })!
    expect(s.protein + s.carbs + s.fat).toBeCloseTo(100)
  })
})
