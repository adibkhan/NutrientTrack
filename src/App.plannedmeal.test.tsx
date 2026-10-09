// Planned entries are not eaten: meal subtotals and the sidebar Diary badge must not count them.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from './types'
import { todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const today = todayISO()
const stamp = '2026-01-01T00:00:00.000Z'
let seq = 0
const entry = (meal: DiaryEntry['meal'], planned: boolean, calories = 100): DiaryEntry =>
  ({ id: `e-${seq++}`, date: today, meal, name: `Food ${seq}`, calories, protein: 7, carbs: 11, fat: 3, planned, createdAt: stamp, updatedAt: stamp }) as DiaryEntry

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function renderWith(entries: DiaryEntry[]) {
  m.getEntries.mockResolvedValue(entries)
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
}
const section = (label: string) => screen.getByRole('heading', { name: label, level: 3 }).closest('section') as HTMLElement
const subtotal = (label: string) => section(label).querySelector('.meal-subtotal')?.textContent
const badge = () => document.querySelector('.sidebar .nav-count')

describe('meal subtotal with planned entries', () => {
  it('says_planned_not_counted_when_every_entry_is_planned', async () => {
    await renderWith([entry('lunch', true), entry('lunch', true)])
    expect(subtotal('Lunch')).toBe('Planned, not counted')
  })

  it('shows_only_the_eaten_subtotal_for_a_mixed_meal', async () => {
    await renderWith([entry('lunch', false, 250), entry('lunch', true, 900)])
    const text = subtotal('Lunch') ?? ''
    expect(text).not.toMatch(/Planned/)
    expect(text).toContain('7 P · 11 C · 3 F · 250')
  })

  it('shows_the_normal_subtotal_for_a_single_eaten_entry', async () => {
    await renderWith([entry('lunch', false, 300)])
    expect(subtotal('Lunch')).toContain('300')
  })

  it('shows_a_dash_for_an_empty_meal', async () => {
    await renderWith([entry('lunch', true)])
    expect(subtotal('Dinner')).toBe('—')
  })
})

describe('sidebar Diary badge', () => {
  it('is_absent_when_the_day_has_only_planned_entries', async () => {
    await renderWith([entry('lunch', true), entry('dinner', true)])
    expect(badge()).toBeNull()
  })

  it('is_absent_for_an_empty_day', async () => {
    await renderWith([])
    expect(badge()).toBeNull()
  })

  it('counts_two_eaten_and_ignores_one_planned', async () => {
    await renderWith([entry('lunch', false), entry('lunch', false), entry('dinner', true)])
    expect(badge()?.textContent).toBe('2')
  })

  it('ignores_eaten_entries_from_other_days', async () => {
    const other = { ...entry('lunch', false), date: '2020-01-01' }
    await renderWith([other, entry('lunch', false)])
    expect(badge()?.textContent).toBe('1')
  })
})
