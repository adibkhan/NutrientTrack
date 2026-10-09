import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, WeightEntry } from './types'

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
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const settingsRecord = (): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb', calories: 2000 }, preferences: { theme: 'light' }, updatedAt: stamp }) as unknown as Settings
const weigh = (id: string, date: string, weight: number, unit: 'lb' | 'kg'): WeightEntry => ({ id, date, weight, unit, createdAt: stamp })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(settingsRecord())
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

async function openTrends(weights: WeightEntry[]) {
  m.getWeights.mockResolvedValue(weights)
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Trends'))
  await screen.findByRole('heading', { name: 'Expenditure' })
}

describe('weight log: converted value', () => {
  it('shows the display-unit value next to a row stored in another unit', async () => {
    await openTrends([weigh('a', '2026-03-01', 80, 'kg')])
    expect(screen.getByText('≈ 176.4 lb')).toBeTruthy()
  })

  it('shows no conversion for a row already in the display unit', async () => {
    await openTrends([weigh('a', '2026-03-01', 180, 'lb')])
    expect(screen.queryByText(/≈/)).toBeNull()
  })

  it('converts only the row whose unit differs when both kinds are present', async () => {
    await openTrends([weigh('a', '2026-03-01', 80, 'kg'), weigh('b', '2026-03-02', 180, 'lb')])
    expect(screen.getAllByText(/≈/)).toHaveLength(1)
  })
})
