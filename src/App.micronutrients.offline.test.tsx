// A catalog food still logs its macros when the USDA nutrient table cannot be fetched (offline before it was ever cached).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../public/data/usda-common-v2.json?raw'
import type { DiaryEntry } from './types'

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
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('usda-nutrients') ? Promise.reject(new Error('offline')) : new Response(catalogText, { status: 200 }))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: '2026-01-01T00:00:00.000Z' })
  m.saveEntry.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('catalog food with no nutrient table', () => {
  it('logs the macros with no nutrient keys instead of failing or writing zeros', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), 'bananas, raw')
    const results = await within(dialog).findByLabelText('Catalog results')
    await user.click(within(results).getAllByRole('button').find((button) => /^Bananas, raw/.test(button.textContent ?? '')) as HTMLElement)
    await within(dialog).findByLabelText('Amount')
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
    expect(saved.calories).toBeGreaterThan(90)
    expect(saved.catalogId).toBe('usda-sr-173944')
    for (const key of ['potassium', 'fiber', 'vitaminC', 'water']) expect(saved).not.toHaveProperty(key)
  })
})
