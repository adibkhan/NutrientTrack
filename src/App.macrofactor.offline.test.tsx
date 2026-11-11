// Offline: the Excel reader chunk fails to load. Settings must still render, CSV import must still work, and a spreadsheet gets a clear message.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from './types'

vi.mock('./lib/xlsx', () => { throw new Error('Failed to fetch dynamically imported module') })
vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(), saveEntriesAndWeights: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp } as Settings)
  m.saveEntriesAndWeights.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks() })

const openPanel = async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
  const panel = await screen.findByRole('region', { name: 'Import from another app' })
  return { user, panel }
}

describe('Settings when the Excel reader cannot load', () => {
  it('renders_the_import_panel_and_explains_a_failed_spreadsheet_pick', async () => {
    const { user, panel } = await openPanel()
    await user.upload(within(panel).getByLabelText('Choose CSV or Excel files'), new File(['x'], 'MacroFactor-Data.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    expect(await within(panel).findByText(/The Excel reader couldn.t load\. Connect to the internet once and try again\./)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Log food' }).length).toBeGreaterThan(0)
  })

  it('still_imports_a_csv', async () => {
    const { user, panel } = await openPanel()
    const csv = 'Date,Time,Food Name,Calories (kcal),Protein (g),Carbs (g),Fat (g)\n2026-10-01,7:45 AM,Yogurt,145,25,9,1\n'
    await user.upload(within(panel).getByLabelText('Choose CSV or Excel files'), new File([csv], 'food.csv', { type: 'text/csv' }))
    expect(await within(panel).findByRole("button", { name: /^Import 1 item/ })).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: /^Import 1 item/ }))
    await vi.waitFor(() => expect(m.saveEntriesAndWeights).toHaveBeenCalledTimes(1))
  })
})
