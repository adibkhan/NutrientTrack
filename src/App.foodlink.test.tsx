// Links from the static food pages (/?log=<catalog id>) open the logger on that food with its household measures.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'

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
const stamp = '2026-01-01T00:00:00.000Z'
const settings = (preferences: Record<string, unknown>): Settings => ({ id: 'profile', goals: { weightUnit: 'lb' }, preferences, updatedAt: stamp } as Settings)

const catalog = [{ id: 'usda-sr-173944', fdcId: 173944, name: 'Bananas, raw', category: 'Fruits and Fruit Juices', source: 'USDA SR Legacy', per100g: { calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 }, portions: [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118]] }]
let entries: DiaryEntry[]
// Past the first-run welcome, so the diary shows Pip's everyday strip.
const welcomed = () => settings({ welcomed: true })
beforeEach(() => {
  entries = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200, headers: { 'Content-Type': 'application/json' } })))
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

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('food page links', () => {
  it('opens_the_logger_on_the_linked_food_and_cleans_the_address', async () => {
    window.history.replaceState(null, '', '/?log=usda-sr-173944&utm_source=x')
    const user = userEvent.setup()
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Bananas, raw')).toBeTruthy()
    expect(window.location.search).toBe('?utm_source=x')
    await user.click(within(dialog).getByRole('button', { name: /1 medium/ }))
    expect((within(dialog).getByLabelText(/Amount/) as HTMLInputElement).value).toBe('118')
    await user.click(within(dialog).getByRole('button', { name: /1 medium/ }))
    expect((within(dialog).getByLabelText(/Amount/) as HTMLInputElement).value).toBe('236')
  })

  it('ignores_a_malformed_link', async () => {
    window.history.replaceState(null, '', '/?log=javascript:alert(1)')
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('home-screen shortcuts and shared text', () => {
  it('opens_the_logger_on_the_meal_from_a_shortcut', async () => {
    window.history.replaceState(null, '', '/?meal=dinner')
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(window.location.search).toBe('')
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: 'Manual quick add' }))
    expect((within(dialog).getByRole('radio', { name: 'Dinner' }) as HTMLInputElement).checked).toBe(true)
  })

  it('opens_the_weight_form_from_the_weigh_shortcut', async () => {
    window.history.replaceState(null, '', '/?weigh=1')
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Weight')).toBeTruthy()
  })

  it('starts_the_search_with_text_shared_from_another_app', async () => {
    window.history.replaceState(null, '', '/?text=2%20eggs%20and%20toast&title=Breakfast')
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByPlaceholderText(/Search foods/) as HTMLInputElement).value).toBe('2 eggs and toast')
    expect(window.location.search).toBe('')
  })
})
