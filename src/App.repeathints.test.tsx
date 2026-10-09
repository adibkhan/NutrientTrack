// Disabled Repeat and Copy yesterday buttons say why, and planned entries never count as "something earlier".
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from './types'
import { shiftDate, todayISO } from './lib/utils'

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
const yesterday = shiftDate(today, -1)
const stamp = '2026-01-01T00:00:00.000Z'
let seq = 0
const entry = (date: string, meal: DiaryEntry['meal'], planned = false): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal, name: `Food ${seq}`, calories: 100, protein: 1, carbs: 1, fat: 1, planned, createdAt: stamp, updatedAt: stamp }) as DiaryEntry

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
const lunchRepeat = () => {
  const section = screen.getByRole('heading', { name: 'Lunch', level: 3 }).closest('section') as HTMLElement
  return section.querySelector('button.repeat-meal') as HTMLButtonElement
}
const copyDay = () => screen.getByRole('button', { name: 'Copy yesterday' }) as HTMLButtonElement
const hint = () => screen.queryByText('Nothing was logged the day before.')

describe('per-meal Repeat button', () => {
  it('says_nothing_earlier_when_the_diary_is_empty', async () => {
    await renderWith([])
    expect(lunchRepeat().disabled).toBe(true)
    expect(lunchRepeat().textContent).toBe('Nothing earlier')
  })

  it('says_nothing_earlier_when_only_planned_entries_exist_earlier', async () => {
    await renderWith([entry(yesterday, 'lunch', true)])
    expect(lunchRepeat().disabled).toBe(true)
    expect(lunchRepeat().textContent).toBe('Nothing earlier')
  })

  it('says_nothing_earlier_when_the_earlier_entry_is_a_different_meal', async () => {
    await renderWith([entry(yesterday, 'dinner')])
    expect(lunchRepeat().textContent).toBe('Nothing earlier')
  })

  it('shows_the_normal_enabled_label_when_an_earlier_eaten_meal_exists', async () => {
    await renderWith([entry(yesterday, 'lunch')])
    expect(lunchRepeat().disabled).toBe(false)
    expect(lunchRepeat().textContent).toContain('Repeat previous Lunch')
    expect(lunchRepeat().textContent).not.toContain('Nothing earlier')
  })
})

describe('Copy yesterday hint', () => {
  it('shows_the_hint_and_disables_the_button_for_an_empty_diary', async () => {
    await renderWith([])
    expect(copyDay().disabled).toBe(true)
    expect(hint()).not.toBeNull()
  })

  it('shows_the_hint_when_yesterday_has_only_planned_entries', async () => {
    await renderWith([entry(yesterday, 'lunch', true)])
    expect(copyDay().disabled).toBe(true)
    expect(hint()).not.toBeNull()
  })

  it('shows_no_hint_when_yesterday_has_eaten_entries', async () => {
    await renderWith([entry(yesterday, 'lunch')])
    expect(copyDay().disabled).toBe(false)
    expect(hint()).toBeNull()
  })
})
