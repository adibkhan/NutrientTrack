import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined), saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(),
  saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const intro = 'Goals and backups live on this device alongside your diary. Cloud backup is optional.'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openSettings() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Settings'))
  await screen.findByRole('heading', { name: 'Goals' })
}

describe('settings page intro', () => {
  it('has a single Settings heading, the top bar h1, and no h2 repeating it', async () => {
    await openSettings()
    const headings = screen.getAllByRole('heading', { name: 'Settings' })
    expect(headings).toHaveLength(1)
    expect(headings[0].tagName).toBe('H1')
  })

  it('no longer shows the Your preferences eyebrow', async () => {
    await openSettings()
    expect(screen.queryByText('Your preferences')).toBeNull()
  })

  it('shows the description sentence exactly once', async () => {
    await openSettings()
    expect(screen.getAllByText(intro)).toHaveLength(1)
  })

  it('keeps the Goals and Local data panel headings', async () => {
    await openSettings()
    expect(screen.getByRole('heading', { level: 2, name: 'Goals' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Local data' })).toBeTruthy()
  })

  it('still renders the goals form with a Calories input', async () => {
    await openSettings()
    const input = screen.getByLabelText(/^Calories/)
    expect(input.tagName).toBe('INPUT')
  })
})
