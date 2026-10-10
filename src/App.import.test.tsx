// Importing another tracker's CSV export from Settings: adds new records only, never overwrites.
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

const LOSEIT = `Date,Name,Icon,Type,Quantity,Units,Calories,Deleted,Fat (g),Protein (g),Carbohydrates (g),Saturated Fat (g),Sugars (g),Fiber (g),Cholesterol (mg),Sodium (mg)
01/05/2026,Oatmeal,Oatmeal,Breakfast,1,Cup,166,false,3.6,5.9,28,0.6,0.6,4,0,9
01/05/2026,Banana,Banana,Snacks,1,Each,105,false,0.4,1.3,27,0.1,14,3,0,1
01/05/2026,Cookie,Cookie,Snacks,2,Each,160,true,8,2,20,4,12,1,10,110
`
const WEIGHTS = `Date,Weight,Deleted
01/05/2026,182.4,false
01/06/2026,181.9,false
`

describe('import from another app', () => {
  it('adds_new_foods_and_weigh_ins_and_skips_what_is_already_here', async () => {
    m.getSettings.mockResolvedValue(welcomed())
    m.getWeights.mockResolvedValue([{ id: 'mine', date: '2026-01-06', weight: 80, unit: 'kg', createdAt: stamp }])
    m.saveEntries.mockResolvedValue(undefined)
    m.saveWeight.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const panel = await screen.findByRole('region', { name: 'Import from another app' })
    await user.upload(within(panel).getByLabelText('Choose CSV files'), [new File([LOSEIT], 'food-logs.csv', { type: 'text/csv' }), new File([WEIGHTS], 'weights.csv', { type: 'text/csv' })])
    expect(await within(panel).findByText(/Lose It! · 2 foods · 1 skipped/)).toBeTruthy()
    await user.selectOptions(within(panel).getByLabelText('Weights in those files are in'), 'kg')
    await user.click(within(panel).getByRole('button', { name: 'Import 4 items' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.map((entry) => [entry.date, entry.meal, entry.name, entry.importedFrom])).toEqual([['2026-01-05', 'breakfast', 'Oatmeal', 'loseit'], ['2026-01-05', 'snack', 'Banana', 'loseit']])
    expect(saved.every((entry) => entry.createdAt && entry.updatedAt)).toBe(true)
    // 01/06 already has a weigh-in, so only 01/05 is added, in the unit chosen.
    expect(m.saveWeight).toHaveBeenCalledTimes(1)
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ date: '2026-01-05', weight: 182.4, unit: 'kg', importedFrom: 'loseit' })
    expect(await within(panel).findByText(/Imported 2 entries and 1 weigh-in\. Anything already here was skipped\./)).toBeTruthy()
  })

  it('skips_entries_whose_ids_already_exist', async () => {
    m.getSettings.mockResolvedValue(welcomed())
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const panel = await screen.findByRole('region', { name: 'Import from another app' })
    await user.upload(within(panel).getByLabelText('Choose CSV files'), new File([LOSEIT], 'food-logs.csv', { type: 'text/csv' }))
    await user.click(await within(panel).findByRole('button', { name: 'Import 2 items' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const first = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    entries = first
    m.saveEntries.mockClear()
    await user.upload(within(panel).getByLabelText('Choose CSV files'), new File([LOSEIT], 'food-logs.csv', { type: 'text/csv' }))
    await user.click(await within(panel).findByRole('button', { name: 'Import 2 items' }))
    expect(await within(panel).findByText(/Imported 0 entries/)).toBeTruthy()
    expect(m.saveEntries).not.toHaveBeenCalled()
  })
})
