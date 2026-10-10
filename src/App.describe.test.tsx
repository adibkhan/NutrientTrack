// Describe-to-log: type a meal, check the matches, add them all at once.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

const catalog = [{ id: 'usda-sr-172184', fdcId: 172184, name: 'Egg, whole, cooked, hard-boiled', category: 'Dairy and Egg Products', source: 'USDA SR Legacy', per100g: { calories: 155, protein: 12.6, carbs: 1.12, fat: 10.6 }, portions: [['1 large', 50]] }, { id: 'usda-sr-1', fdcId: 1, name: 'Bread, whole-wheat, commercially prepared, toasted', category: 'Baked Products', source: 'USDA SR Legacy', per100g: { calories: 306, protein: 16, carbs: 51, fat: 4 }, portions: [['1 slice', 25]] }, { id: 'usda-sr-173944', fdcId: 173944, name: 'Bananas, raw', category: 'Fruits and Fruit Juices', source: 'USDA SR Legacy', per100g: { calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 }, portions: [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118]] }]
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

describe('describe-to-log', () => {
  it('logs_every_reviewed_match_with_its_household_amount', async () => {
    m.saveEntries.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), '2 eggs, toast and a banana, mystery stew')
    const card = await within(dialog).findByRole('region', { name: 'Log as a meal' })
    expect(within(card).getByText(/No match for “mystery stew”/)).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Remove Bananas, raw' }))
    await user.click(within(card).getByRole('button', { name: /Add 2 foods/ }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.map((entry) => [entry.name, entry.grams, entry.calories, entry.catalogId])).toEqual([
      ['Egg, whole, cooked, hard-boiled', 100, 155, 'usda-sr-172184'],
      ['Bread, whole-wheat, commercially prepared, toasted', 25, 76.5, 'usda-sr-1'],
    ])
    expect(new Set(saved.map((entry) => entry.id)).size).toBe(2)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
