import { describe, expect, it } from 'vitest'
import type { DiaryEntry } from '../types'
import { sumEntries } from './utils'

const stamp = '2026-01-01T00:00:00.000Z'
const e = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'x', date: '2026-01-01', meal: 'lunch', name: 'Food', calories: 100, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})

describe('sumEntries and planned entries', () => {
  it('returns zero totals for an empty list', () => {
    expect(sumEntries([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('adds every eaten entry', () => {
    expect(sumEntries([e(), e({ calories: 50, protein: 1, carbs: 2, fat: 3 })])).toEqual({ calories: 150, protein: 11, carbs: 22, fat: 8 })
  })

  it('ignores a planned entry', () => {
    expect(sumEntries([e(), e({ planned: true, calories: 900 })])).toEqual({ calories: 100, protein: 10, carbs: 20, fat: 5 })
  })

  it('returns zero totals when every entry is planned', () => {
    expect(sumEntries([e({ planned: true }), e({ planned: true })])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('counts an entry with planned explicitly false as eaten', () => {
    expect(sumEntries([e({ planned: false })]).calories).toBe(100)
  })
})
