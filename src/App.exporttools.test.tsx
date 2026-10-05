// Settings renders the "Export spreadsheets" panel with the real stored counts.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food } from './types'
import { todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))
vi.mock('./lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/csv')>()),
  downloadTextFile: vi.fn(),
}))

import * as db from './lib/db'
import { downloadTextFile } from './lib/csv'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const entry = (id: string): DiaryEntry => ({ id, date: todayISO(), meal: 'lunch', name: `Food ${id}`, calories: 1, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([entry('1'), entry('2'), entry('3')])
  m.getFoods.mockResolvedValue([{ id: 'f', name: 'Rice', serving: '1', calories: 1, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp } as Food])
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

describe('Settings export panel', () => {
  async function openSettings() {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Settings'))
    return user
  }

  it('shows the real counts for diary, weights and foods', async () => {
    await openSettings()
    const panel = (await screen.findByRole('heading', { name: 'Export spreadsheets' })).closest('section') as HTMLElement
    const row = (label: string) => within(panel).getByText(label).closest('.tool-row') as HTMLElement
    expect(within(row('Food diary')).getByText('3 rows')).toBeTruthy()
    expect(within(row('Weight log')).getByText('Nothing here yet.')).toBeTruthy()
    expect(within(row('Saved foods')).getByText('1 row')).toBeTruthy()
  })

  it('downloads the diary CSV and announces it', async () => {
    const user = await openSettings()
    const panel = (await screen.findByRole('heading', { name: 'Export spreadsheets' })).closest('section') as HTMLElement
    await user.click(within(within(panel).getByText('Food diary').closest('.tool-row') as HTMLElement).getByRole('button', { name: 'CSV' }))
    expect(downloadTextFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(downloadTextFile).mock.calls[0][0]).toBe(`nutrienttrack-diary-${todayISO()}.csv`)
    expect(await screen.findByText('Food diary exported as CSV.')).toBeTruthy()
  })
})
