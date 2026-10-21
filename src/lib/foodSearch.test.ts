import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Food } from '../types'
import { dropExistingDuplicates, filterAndSortFoods, foldText, matchesTokens } from './foodSearch'
import { parseImport } from './importers'

const food = (id: string, name: string, extra: Partial<Food> = {}): Food => ({ id, name, serving: '1 serving', calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra })
const entry = (id: string, foodId: string, date: string): DiaryEntry => ({ id, foodId, date, meal: 'lunch', name: 'x', calories: 1, protein: 0, carbs: 0, fat: 0, createdAt: '', updatedAt: '' })

describe('token matching', () => {
  it('folds case and diacritics', () => {
    expect(foldText('Crème Brûlée')).toBe('creme brulee')
    expect(matchesTokens('Crème Brûlée', 'CREME bru')).toBe(true)
  })
  it('needs every token to prefix some word, in any order', () => {
    expect(matchesTokens('Grilled chicken breast', 'breast chick')).toBe(true)
    expect(matchesTokens('Grilled chicken breast', 'chick rice')).toBe(false)
    expect(matchesTokens('Blueberry muffin', 'berry')).toBe(true)
    expect(matchesTokens('Blueberry muffin', 'xberry')).toBe(false)
    expect(matchesTokens('Anything', '   ')).toBe(true)
  })
})

describe('food ordering', () => {
  const foods = [food('a', 'Apple'), food('b', 'Banana', { createdAt: '2026-03-01T00:00:00.000Z' }), food('c', 'Cherry'), food('d', 'Date', { favorite: true })]
  const entries = [entry('1', 'a', '2026-05-01'), entry('2', 'a', '2026-05-02'), entry('3', 'c', '2026-06-01')]
  it('sorts A to Z', () => expect(filterAndSortFoods(foods, entries, '', 'az').map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']))
  it('sorts by use count, ties by name', () => expect(filterAndSortFoods(foods, entries, '', 'used').map((f) => f.id)).toEqual(['a', 'c', 'b', 'd']))
  it('sorts recent by last logged, favorites first, unused by save date', () => expect(filterAndSortFoods(foods, entries, '', 'recent').map((f) => f.id)).toEqual(['d', 'c', 'a', 'b']))
  it('filters before sorting', () => expect(filterAndSortFoods(foods, entries, 'ch', 'az').map((f) => f.id)).toEqual(['c']))
})

describe('re-importing a MyFitnessPal export', () => {
  const CSV = `Date,Meal,Calories,Fat (g),Carbohydrates (g),Protein (g)
2026-09-28,Breakfast,550,15,60,45
2026-09-28,Dinner,"1,000",30,90,90
2026-09-29,Lunch,700,20,70,50
`
  const imported = parseImport(CSV)!.entries
  const stamped = (list: typeof imported) => list.map((item) => ({ ...item, createdAt: '', updatedAt: '' }))
  it('imports everything into an empty diary', () => {
    expect(dropExistingDuplicates(imported, [])).toMatchObject({ duplicates: 0, fresh: { length: 3 } })
  })
  it('skips rows that match by id', () => {
    const result = dropExistingDuplicates(imported, stamped(imported))
    expect(result).toMatchObject({ duplicates: 3, fresh: [] })
  })
  it('skips rows that match by date, meal, name and calories even with other ids', () => {
    const existing = stamped(imported).slice(0, 2).map((item, index) => ({ ...item, id: `mine-${index}` }))
    const result = dropExistingDuplicates(imported, existing)
    expect(result.duplicates).toBe(2)
    expect(result.fresh.map((item) => item.date)).toEqual(['2026-09-29'])
  })
  it('keeps a row whose calories differ', () => {
    const existing = [{ ...stamped(imported)[0], id: 'mine', calories: 551 }]
    expect(dropExistingDuplicates(imported, existing).duplicates).toBe(0)
  })
})
