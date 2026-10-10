// Pip on the diary, the compact empty meals and the fresh-entry feedback.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'
import { shiftDate, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
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
const entry = (date: string, meal: DiaryEntry['meal'], over: Partial<DiaryEntry> = {}): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal, name: `Food ${seq}`, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp, ...over })
const settings = (preferences: Record<string, unknown>): Settings => ({ id: 'profile', goals: { weightUnit: 'lb' }, preferences, updatedAt: stamp } as Settings)

let entries: DiaryEntry[]
// Past the first-run welcome, so the diary shows Pip's everyday strip.
const welcomed = () => settings({ welcomed: true })
beforeEach(() => {
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(welcomed())
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
  m.saveSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
const pip = () => screen.queryByRole('region', { name: 'Pip, your logging buddy' })

describe('Pip on the diary', () => {
  it('greets_on_an_empty_today_and_replaces_the_empty_banner', async () => {
    await renderApp()
    expect(pip()).not.toBeNull()
    expect(within(pip() as HTMLElement).getByRole('status').textContent).toBeTruthy()
    expect(screen.queryByText('No foods logged yet')).toBeNull()
  })

  it('opens_the_logger_from_its_action', async () => {
    const user = await renderApp()
    await user.click(within(pip() as HTMLElement).getByRole('button', { name: /^Log / }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('copies_yesterday_from_its_action', async () => {
    entries = [entry(yesterday, 'lunch', { name: 'Leftover curry' })]
    const user = await renderApp()
    await user.click(within(pip() as HTMLElement).getByRole('button', { name: 'Copy it over' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect((m.saveEntries.mock.calls[0][0] as DiaryEntry[]).map((copy) => copy.date)).toEqual([today])
  })

  it('can_be_dismissed', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Hide Pip’s message' }))
    expect(pip()).toBeNull()
  })

  it('stays_away_on_other_days', async () => {
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Previous day' })[0])
    expect(pip()).toBeNull()
    expect(screen.getByText('No foods logged yet')).toBeTruthy()
  })

  it('is_hidden_when_turned_off_and_the_empty_banner_returns', async () => {
    m.getSettings.mockResolvedValue(settings({ mascot: false }))
    await renderApp()
    await screen.findByText('No foods logged yet')
    expect(pip()).toBeNull()
  })

  it('turns_off_from_preferences_storing_false_and_keeping_unknown_fields', async () => {
    m.getSettings.mockResolvedValue(settings({ theme: 'dark', futureThing: 7 }))
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const toggle = await screen.findByLabelText(/Show Pip on the diary/) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    await user.click(toggle)
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalled())
    const saved = m.saveSettings.mock.calls.at(-1)?.[0] as Settings & { preferences: Record<string, unknown> }
    expect(saved.preferences).toMatchObject({ theme: 'dark', futureThing: 7, mascot: false })
  })
})

describe('compact empty meals', () => {
  it('keeps_an_Add_button_but_drops_the_placeholder_text_and_subtotal', async () => {
    entries = [entry(today, 'lunch')]
    await renderApp()
    const dinner = screen.getByRole('heading', { name: 'Dinner', level: 3 }).closest('section') as HTMLElement
    expect(dinner.classList.contains('is-empty')).toBe(true)
    expect(within(dinner).getByRole('button', { name: 'Add' })).toBeTruthy()
    expect(dinner.querySelector('.meal-subtotal')).toBeNull()
    expect(within(dinner).queryByText('Add a food to start this section.')).toBeNull()
    const lunch = screen.getByRole('heading', { name: 'Lunch', level: 3 }).closest('section') as HTMLElement
    expect(lunch.classList.contains('is-empty')).toBe(false)
  })
})

describe('fresh entry feedback', () => {
  it('marks_only_just_saved_entries_and_taps_once', async () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    entries = [entry(today, 'lunch', { name: 'Old soup' }), entry(today, 'dinner', { name: 'New pasta', createdAt: new Date().toISOString() })]
    await renderApp()
    const row = (name: string) => screen.getByText(name).closest('.entry-row') as HTMLElement
    expect(row('New pasta').classList.contains('is-fresh')).toBe(true)
    expect(row('Old soup').classList.contains('is-fresh')).toBe(false)
    await waitFor(() => expect(vibrate).toHaveBeenCalledTimes(1))
  })
})

describe('reflux watch', () => {
  it('turns_on_from_preferences_and_keeps_other_preferences', async () => {
    m.getSettings.mockResolvedValue(settings({ welcomed: true, theme: 'dark' }))
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    await user.click(await screen.findByLabelText(/Reflux watch/))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalled())
    const saved = m.saveSettings.mock.calls.at(-1)?.[0] as Settings & { preferences: Record<string, unknown> }
    expect(saved.preferences).toMatchObject({ welcomed: true, theme: 'dark', refluxWatch: true })
  })

  it('makes_pip_uneasy_and_name_todays_triggers', async () => {
    m.getSettings.mockResolvedValue(settings({ welcomed: true, refluxWatch: true }))
    entries = [entry(today, 'breakfast', { name: 'Black coffee' }), entry(today, 'lunch', { name: 'Pepperoni pizza' })]
    await renderApp()
    const strip = pip() as HTMLElement
    expect(strip.classList.contains('mascot-uneasy')).toBe(true)
    expect(within(strip).getByRole('status').textContent).toBe('Heads up: coffee and tomato are common reflux triggers.')
  })
})
