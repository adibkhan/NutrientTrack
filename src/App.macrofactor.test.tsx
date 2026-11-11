// Importing MacroFactor's Excel export from Settings: preview, one atomic save, re-import adds nothing.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings, WeightEntry } from './types'
import { buildXlsx } from './lib/testkit/xlsxBuilder'

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
let entries: DiaryEntry[]
let weights: WeightEntry[]

const workbook = () => new File([Uint8Array.from(buildXlsx([
  { name: 'Food Log', rows: [['Date', 'Time', 'Food Name', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'], ['2026-10-01', '7:45 AM', 'Yogurt', 145, 25, 9, 1], ['bad', null, 'Broken', 1, 1, 1, 1]] },
  { name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], ['2026-10-01', 80]] },
  { name: 'Expenditure', rows: [['Date', 'Expenditure'], ['2026-10-01', 2500]] },
]))], 'MacroFactor-Data.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

beforeEach(() => {
  entries = []
  weights = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockImplementation(async () => entries)
  m.getWeights.mockImplementation(async () => weights)
  m.getFoods.mockResolvedValue([])
  m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp } as Settings)
  m.saveEntriesAndWeights.mockImplementation(async (saved, savedWeights) => { entries = [...entries, ...saved]; weights = [...weights, ...savedWeights] })
  m.saveSettings.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('import MacroFactor xlsx', () => {
  it('previews_each_sheet_then_saves_foods_and_weights_together_and_a_second_import_adds_nothing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const panel = await screen.findByRole('region', { name: 'Import from another app' })
    await user.upload(within(panel).getByLabelText('Choose CSV or Excel files'), workbook())
    expect(await within(panel).findByText("Food Log · 1 food · 1 couldn't be read")).toBeTruthy()
    expect(within(panel).getByText('Scale Weight · 1 weigh-in')).toBeTruthy()
    expect(within(panel).getByText(/Expenditure history isn.t imported/)).toBeTruthy()
    expect(within(panel).getByText('1 food · 1 weigh-in will be added.')).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Import 2 items' }))
    await waitFor(() => expect(m.saveEntriesAndWeights).toHaveBeenCalledTimes(1))
    const [savedEntries, savedWeights] = m.saveEntriesAndWeights.mock.calls[0]
    expect(savedEntries).toMatchObject([{ date: '2026-10-01', meal: 'breakfast', time: '07:45', name: 'Yogurt', calories: 145, importedFrom: 'macrofactor' }])
    expect(savedWeights).toMatchObject([{ date: '2026-10-01', weight: 176.37, unit: 'lb', importedFrom: 'macrofactor' }])
    expect(await within(panel).findByText(/Imported 1 entry and 1 weigh-in\./)).toBeTruthy()

    m.saveEntriesAndWeights.mockClear()
    await user.upload(within(panel).getByLabelText('Choose CSV or Excel files'), workbook())
    expect(await within(panel).findByText('Nothing new to import.')).toBeTruthy()
    expect((within(panel).getByRole('button', { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(m.saveEntriesAndWeights).not.toHaveBeenCalled()
  })

  it('says_so_when_a_workbook_cannot_be_opened', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const panel = await screen.findByRole('region', { name: 'Import from another app' })
    await user.upload(within(panel).getByLabelText('Choose CSV or Excel files'), new File(['nope'], 'broken.xlsx'))
    expect(await within(panel).findByText(/not a readable Excel workbook/)).toBeTruthy()
    expect((within(panel).getByRole('button', { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
