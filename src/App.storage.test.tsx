import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from './types'
import { todayISO } from './lib/utils'

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
const baseEntry: DiaryEntry = { id: 'e1', name: 'Porridge', meal: 'breakfast', date: todayISO(), calories: 300, protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp }
const toastText = () => (document.querySelector('.toast') as HTMLElement | null)?.textContent ?? ''

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
  m.saveSettings.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('storage unavailable at load', () => {
  it('shows a blocking notice instead of first-run setup', async () => {
    m.getEntries.mockRejectedValue(new Error('denied'))
    render(<App />)
    expect(await screen.findByText(/Your browser is blocking storage, so NutrientTrack can't save anything/)).toBeTruthy()
    expect(screen.queryByText(/Skip for now/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /add food|log food/i })).toBeNull()
  })

  it('shows the first-run setup when storage works and is empty', async () => {
    render(<App />)
    await waitFor(() => expect(screen.queryByText(/Your browser is blocking storage/)).toBeNull())
    await waitFor(() => expect(document.querySelector('.loading-shell')).toBeNull())
  })
})

describe('save failures', () => {
  it('says the device is out of space when the transaction aborts for quota', async () => {
    m.getEntries.mockResolvedValue([baseEntry])
    m.saveSettings.mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }))
    render(<App />)
    const user = userEvent.setup()
    await screen.findByText('Porridge')
    await user.click(screen.getAllByRole('button', { name: /settings/i })[0])
    const calories = await screen.findByLabelText(/calories/i, { selector: '#goal-calories' })
    await user.clear(calories)
    await user.type(calories, '2100')
    await user.click(screen.getByRole('button', { name: /save goals/i }))
    await waitFor(() => expect(toastText()).toContain("Your device is out of storage space, so this wasn't saved."))
  })
})

describe('cross-tab refresh and deleted entries', () => {
  it('reloads data when another tab reports a write', async () => {
    const listeners: Array<(source: 'local' | 'remote') => void> = []
    m.onLocalChange.mockImplementation((next) => { listeners.push(next); return () => undefined })
    const emit = (source: 'local' | 'remote') => listeners.forEach((fn) => fn(source))
    render(<App />)
    await waitFor(() => expect(document.querySelector('.loading-shell')).toBeNull())
    const before = m.getEntries.mock.calls.length
    emit('local')
    expect(m.getEntries.mock.calls.length).toBe(before)
    m.getEntries.mockResolvedValue([baseEntry])
    emit('remote')
    expect(await screen.findByText('Porridge')).toBeTruthy()
  })

  it('tells the user when the entry being edited was deleted in another tab', async () => {
    m.getEntries.mockResolvedValue([baseEntry])
    m.saveEntry.mockRejectedValue(Object.assign(new Error('gone'), { name: 'RecordMissingError' }))
    render(<App />)
    const user = userEvent.setup()
    await screen.findByText('Porridge')
    await user.click(screen.getAllByRole('button', { name: /edit/i })[0])
    await user.click(await screen.findByRole('button', { name: /save/i }))
    await waitFor(() => expect(toastText()).toContain('That entry was deleted in another tab.'))
    expect(m.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { mustExist: true })
  })
})
