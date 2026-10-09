import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from './types'

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
let stored: Settings | undefined
const settingsRecord = (goals: Record<string, unknown> = { weightUnit: 'lb', calories: 2000 }): Settings =>
  ({ id: 'profile', goals, preferences: { theme: 'light' }, updatedAt: stamp }) as unknown as Settings

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  stored = undefined
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockImplementation(async () => stored)
  m.saveSettings.mockImplementation(async (next) => { stored = next as Settings })
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

async function renderApp() {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
}

describe('Settings goals: calorie goal of zero', () => {
  async function saveCalories(value: string, viaSubmit = false) {
    stored = settingsRecord()
    const user = userEvent.setup()
    await renderApp()
    await user.click(first('Settings'))
    const input = (await screen.findByLabelText(/^Calories/)) as HTMLInputElement
    fireEvent.change(input, { target: { value } })
    if (viaSubmit) fireEvent.submit(input.closest('form') as HTMLFormElement)
    else await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    return user
  }
  const saved = () => (m.saveSettings.mock.calls.at(-1)?.[0] as unknown as { goals: Record<string, unknown> }).goals

  it('stores no calorie goal when zero is saved, and the diary offers to set one', async () => {
    const user = await saveCalories('0')
    expect(saved().calories).toBeUndefined()
    expect(saved().weightUnit).toBe('lb')
    await user.click(first('Diary'))
    expect(await screen.findByRole('button', { name: /Set an energy goal/ })).toBeTruthy()
  })

  it('stores no calorie goal when a negative number is submitted', async () => {
    await saveCalories('-50', true)
    expect(saved().calories).toBeUndefined()
  })

  it('still saves a positive calorie goal', async () => {
    await saveCalories('1800')
    expect(saved().calories).toBe(1800)
  })

  it('explains that the weight unit also sets water and body measurement units', async () => {
    stored = settingsRecord()
    const user = userEvent.setup()
    await renderApp()
    await user.click(first('Settings'))
    expect(await screen.findByText(/Also sets water.*body measurements/)).toBeTruthy()
  })
})
