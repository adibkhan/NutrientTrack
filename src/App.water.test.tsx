// Water row on the diary: one record per viewed day, id equal to the date, never saved as zero.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, WaterLog } from './types'
import { shiftDate, todayISO } from './lib/utils'

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
const settings = (unit: 'lb' | 'kg'): Settings => ({ id: 'profile', goals: { weightUnit: unit }, updatedAt: stamp })
const log = (date: string, ml: number, extra: Record<string, unknown> = {}): WaterLog => ({ id: date, date, ml, createdAt: stamp, updatedAt: stamp, ...extra }) as WaterLog
const shown = () => document.querySelector('.water-value')?.textContent

/** A tiny in-memory water store so a save followed by the app's refresh shows the new total. */
let store: WaterLog[] = []

beforeEach(() => {
  store = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.getMeasurements.mockResolvedValue([])
  m.getWaterLogs.mockImplementation(() => Promise.resolve(structuredClone(store)))
  m.saveWaterLog.mockImplementation((next) => { store = [...store.filter((item) => item.id !== next.id), next]; return Promise.resolve() })
  m.deleteWaterLog.mockImplementation((id) => { store = store.filter((item) => item.id !== id); return Promise.resolve() })
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}

describe('water row', () => {
  it('shows Water and 0 fl oz with nothing logged, and the remove button is disabled', async () => {
    await renderApp()
    expect(screen.getByText('Water')).toBeTruthy()
    expect(shown()).toBe('0 fl oz')
    expect((screen.getByRole('button', { name: 'Remove 8 fl oz of water' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves 237 ml under the viewed date and then shows 8 fl oz', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Add 8 fl oz of water' }))

    await waitFor(() => expect(shown()).toBe('8 fl oz'))
    expect(m.saveWaterLog).toHaveBeenCalledTimes(1)
    expect(m.saveWaterLog.mock.calls[0][0]).toMatchObject({ id: todayISO(), date: todayISO(), ml: 237 })
    expect((screen.getByRole('button', { name: 'Remove 8 fl oz of water' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('deletes the record instead of saving zero when removed back to 0', async () => {
    store = [log(todayISO(), 237)]
    const user = await renderApp()
    await waitFor(() => expect(shown()).toBe('8 fl oz'))
    await user.click(screen.getByRole('button', { name: 'Remove 8 fl oz of water' }))

    await waitFor(() => expect(m.deleteWaterLog).toHaveBeenCalledWith(todayISO()))
    expect(m.saveWaterLog).not.toHaveBeenCalled()
    await waitFor(() => expect(shown()).toBe('0 fl oz'))
  })

  it('uses 250 ml glasses for kg users', async () => {
    m.getSettings.mockResolvedValue(settings('kg'))
    const user = await renderApp()
    expect(shown()).toBe('0 ml')
    await user.click(screen.getByRole('button', { name: 'Add 250 ml of water' }))

    await waitFor(() => expect(shown()).toBe('250 ml'))
    expect(m.saveWaterLog.mock.calls[0][0].ml).toBe(250)
  })

  it('keeps unknown fields and createdAt on a stored record when adjusted', async () => {
    store = [log(todayISO(), 237, { futureField: { kept: true } })]
    const user = await renderApp()
    await waitFor(() => expect(shown()).toBe('8 fl oz'))
    await user.click(screen.getByRole('button', { name: 'Add 8 fl oz of water' }))

    await waitFor(() => expect(m.saveWaterLog).toHaveBeenCalledTimes(1))
    expect(m.saveWaterLog.mock.calls[0][0]).toMatchObject({ id: todayISO(), ml: 474, createdAt: stamp, futureField: { kept: true } })
  })

  it('is per viewed date: yesterday shows its own amount and saves under its own id', async () => {
    const yesterday = shiftDate(todayISO(), -1)
    store = [log(todayISO(), 474), log(yesterday, 237)]
    const user = await renderApp()
    await waitFor(() => expect(shown()).toBe('16 fl oz'))
    await user.click(first('Previous day'))
    await waitFor(() => expect(shown()).toBe('8 fl oz'))

    await user.click(screen.getByRole('button', { name: 'Add 8 fl oz of water' }))
    await waitFor(() => expect(m.saveWaterLog).toHaveBeenCalledTimes(1))
    expect(m.saveWaterLog.mock.calls[0][0]).toMatchObject({ id: yesterday, date: yesterday, ml: 474 })
    expect(store.find((item) => item.id === todayISO())?.ml).toBe(474)
  })
})
