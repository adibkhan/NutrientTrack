import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

describe('database events while loading', () => {
  it('shows the blocked toast next to the loading shell when the first open is stuck', async () => {
    let listener: ((event: db.DatabaseEvent) => void) | undefined
    m.onDatabaseEvent.mockImplementation((next) => { listener = next; return () => undefined })
    m.getEntries.mockReturnValue(new Promise(() => undefined))
    render(<App />)
    await waitFor(() => expect(listener).toBeDefined())
    expect(screen.queryAllByRole('button', { name: 'Log food' })).toHaveLength(0)
    act(() => listener?.('blocked'))
    expect(await screen.findByText('NutrientTrack is updating. Close its other open tabs to finish.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Log food' })).toHaveLength(0)
  })
})
