// A new weigh-in on a day with two stored records replaces the later-created one.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightEntry } from './types'
import { todayISO } from './lib/utils'

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
const today = todayISO()
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const rec = (id: string, createdAt: string, weight: number): WeightEntry => ({ id, date: today, weight, unit: 'lb', createdAt }) as WeightEntry

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function weighIn(stored: WeightEntry[]) {
  m.getWeights.mockResolvedValue(stored)
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Trends'))
  await user.click(first('Log weight'))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: today } })
  await user.clear(within(dialog).getByLabelText('Weight'))
  await user.type(within(dialog).getByLabelText('Weight'), '175')
  await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
  await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
  return m.saveWeight.mock.calls[0][0] as WeightEntry
}

describe('same-day weigh-in with two stored records', () => {
  it('replaces_the_record_with_the_later_createdAt_when_it_is_stored_last', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const saved = await weighIn([rec('early', '2026-01-01T06:00:00.000Z', 181), rec('late', '2026-01-01T20:00:00.000Z', 179)])
    expect(saved).toMatchObject({ id: 'late', createdAt: '2026-01-01T20:00:00.000Z', weight: 175 })
  })

  it('replaces_the_record_with_the_later_createdAt_even_when_it_is_returned_first', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const saved = await weighIn([rec('late', '2026-01-01T20:00:00.000Z', 179), rec('early', '2026-01-01T06:00:00.000Z', 181)])
    expect(saved).toMatchObject({ id: 'late', createdAt: '2026-01-01T20:00:00.000Z', weight: 175 })
  })
})
