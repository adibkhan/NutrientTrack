// Uneven calorie days with plate logging: the diary's "kcal left" after a plate is logged counts from that weekday's target, not the flat goal.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings } from './types'
import { dateFromISO, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteEntries: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(), saveEntriesAndWeights: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
vi.setConfig({ testTimeout: 30000 })
const stamp = '2026-01-01T00:00:00.000Z'
const feast: Food = { id: 'f1', name: 'Feast', serving: '1 plate', calories: 600, protein: 20, carbs: 60, fat: 20, createdAt: stamp, updatedAt: stamp }
const shift = (() => { const days = Array(7).fill(0); const day = dateFromISO(todayISO()).getDay(); days[day] = 300; days[(day + 1) % 7] = -300; return days })()
let entries: DiaryEntry[]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  entries = []
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([feast])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb', calories: 2100, calorieShift: shift }, preferences: { welcomed: true }, updatedAt: stamp } as unknown as Settings)
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks() })

describe('plate x calorie shift', () => {
  it('shows kcal left from today\'s shifted target after logging a plate', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('tab', { name: /My foods/ }))
    await user.click(await within(dialog).findByRole('button', { name: /^Add Feast to plate/ }))
    // The tray shows what the plate adds, not a goal figure.
    expect(within(screen.getByRole('region', { name: 'Plate' })).queryByText(/left/)).toBeNull()
    await user.click(within(screen.getByRole('region', { name: 'Plate' })).getByRole('button', { name: 'Log 1 food' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    await waitFor(() => expect(document.body.textContent).toContain('1,800'))
    expect(document.body.textContent).toContain('600 of 2,400 kcal')
  })
})
