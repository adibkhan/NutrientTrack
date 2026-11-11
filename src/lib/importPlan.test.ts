import { describe, expect, it } from 'vitest'
import type { DiaryEntry, WeightEntry } from '../types'
import { planImport } from './importPlan'
import { MACROFACTOR_DAY_TOTAL, parseMacroFactorSheets } from './macrofactorImport'
import { readXlsx } from './xlsx'
import { buildXlsx } from './testkit/xlsxBuilder'

const stamp = '2026-11-01T00:00:00.000Z'
const lb = { targetUnit: 'lb', assumedUnit: 'lb' } as const
const read = async () => {
  const book = await readXlsx(buildXlsx([
    { name: 'Food Log', rows: [['Date', 'Time', 'Food Name', 'Calories', 'Protein', 'Carbs', 'Fat'], ['2026-10-01', '8:00 AM', 'Oats', 300, 10, 50, 5], ['2026-10-01', '8:00 AM', 'Egg', 70, 6, 0, 5], ['2026-10-01', '8:00 AM', 'Egg', 70, 6, 0, 5]] },
    { name: 'Calories & Macros', rows: [['Date', 'Calories', 'Protein', 'Fat', 'Carbs'], ['2026-10-01', 2000, 100, 60, 200], ['2026-10-02', 1800, 90, 50, 190]] },
    { name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], ['2026-10-01', 80], ['2026-10-01', 81], ['2026-10-02', 79]] },
  ]))
  return parseMacroFactorSheets(book.sheets, lb)
}
const asDiary = (items: Array<{ id: string; date: string; meal: DiaryEntry['meal']; name: string; calories: number }>): DiaryEntry[] =>
  items.map((item) => ({ protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp, ...item }))

describe('planImport with MacroFactor data', () => {
  it('adds_foods_and_the_days_without_foods_and_one_weigh_in_per_day', async () => {
    const parsed = await read()
    const plan = planImport(parsed.entries, parsed.weights, { entries: [], weights: [] }, stamp)
    expect(plan.entries.map((entry) => [entry.date, entry.name])).toEqual([['2026-10-01', 'Oats'], ['2026-10-01', 'Egg'], ['2026-10-01', 'Egg'], ['2026-10-02', MACROFACTOR_DAY_TOTAL]])
    expect(plan.coveredDays).toBe(1)
    expect(plan.weights.map((weight) => [weight.date, weight.weight])).toEqual([['2026-10-01', 176.37], ['2026-10-02', 174.17]])
    expect(plan.duplicateWeights).toBe(1)
    expect(plan.entries.every((entry) => entry.createdAt === stamp && entry.updatedAt === stamp)).toBe(true)
  })

  it('importing_the_same_file_again_adds_nothing', async () => {
    const parsed = await read()
    const first = planImport(parsed.entries, parsed.weights, { entries: [], weights: [] }, stamp)
    const again = planImport(parsed.entries, parsed.weights, { entries: first.entries, weights: first.weights }, stamp)
    expect(again.entries).toEqual([])
    expect(again.weights).toEqual([])
    expect(again.duplicates).toBe(first.entries.length)
  })

  it('an_existing_weigh_in_keeps_its_day_and_counts_as_skipped', async () => {
    const parsed = await read()
    const mine: WeightEntry = { id: 'mine', date: '2026-10-01', weight: 170, unit: 'lb', createdAt: stamp }
    const plan = planImport(parsed.entries, parsed.weights, { entries: [], weights: [mine] }, stamp)
    expect(plan.weights.map((weight) => weight.date)).toEqual(['2026-10-02'])
    expect(plan.duplicateWeights).toBe(2)
  })

  it('a_day_already_logged_here_gets_no_day_total_but_other_days_do', async () => {
    const parsed = await read()
    const logged = asDiary([{ id: 'mine', date: '2026-10-02', meal: 'lunch', name: 'My lunch', calories: 500 }])
    const plan = planImport(parsed.entries, parsed.weights, { entries: logged, weights: [] }, stamp)
    expect(plan.entries.some((entry) => entry.name === MACROFACTOR_DAY_TOTAL)).toBe(false)
    expect(plan.coveredDays).toBe(2)
    // A planned entry is not food eaten.
    const planned = asDiary([{ id: 'p', date: '2026-10-02', meal: 'lunch', name: 'Plan', calories: 500 }]).map((entry) => ({ ...entry, planned: true }))
    expect(planImport(parsed.entries, parsed.weights, { entries: planned, weights: [] }, stamp).entries.some((entry) => entry.date === '2026-10-02')).toBe(true)
  })
})

describe('granular foods onto a day that only holds an imported day total', () => {
  const total = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({ id: 'old-total', date: '2026-10-01', meal: 'other', name: MACROFACTOR_DAY_TOTAL, calories: 2000, protein: 100, carbs: 200, fat: 60, importedFrom: 'macrofactor', importedKind: 'day-total', createdAt: stamp, updatedAt: stamp, ...over })
  const foods = async () => {
    const parsed = await read()
    return { ...parsed, entries: parsed.entries.filter((entry) => entry.importedKind !== 'day-total') }
  }

  it('replaces_the_total_in_the_same_plan_so_calories_are_not_doubled', async () => {
    const parsed = await foods()
    const plan = planImport(parsed.entries, [], { entries: [total()], weights: [] }, stamp)
    expect(plan.replaced.map((entry) => entry.id)).toEqual(['old-total'])
    expect(plan.entries.filter((entry) => entry.date === '2026-10-01')).toHaveLength(3)
  })
  it('recognises_a_total_by_name_when_it_has_no_marker_field', async () => {
    const parsed = await foods()
    const { importedKind: _kind, ...legacy } = total()
    expect(planImport(parsed.entries, [], { entries: [legacy], weights: [] }, stamp).replaced).toHaveLength(1)
  })
  it('never_touches_what_the_person_logged_or_edited', async () => {
    const parsed = await foods()
    const mine = asDiary([{ id: 'mine', date: '2026-10-01', meal: 'lunch', name: 'My lunch', calories: 500 }])
    expect(planImport(parsed.entries, [], { entries: [total(), ...mine], weights: [] }, stamp).replaced).toEqual([])
    expect(planImport(parsed.entries, [], { entries: [total({ updatedAt: '2026-10-05T00:00:00.000Z' })], weights: [] }, stamp).replaced).toEqual([])
    expect(planImport(parsed.entries, [], { entries: mine, weights: [] }, stamp).replaced).toEqual([])
  })
  it('keeps_the_total_when_no_foods_arrive_for_its_day', async () => {
    const parsed = await foods()
    const other = parsed.entries.filter((entry) => entry.date !== '2026-10-01')
    expect(planImport(other, [], { entries: [total()], weights: [] }, stamp).replaced).toEqual([])
  })
  it('counts_records_the_sync_rules_reject_as_unreadable_not_as_duplicates', async () => {
    const parsed = await read()
    const bad = { ...parsed.entries[0], calories: Number.NaN }
    const plan = planImport([bad], [], { entries: [], weights: [] }, stamp)
    expect(plan.entries).toEqual([])
    expect(plan.rejected).toBe(1)
    expect(plan.duplicates).toBe(0)
  })
})
