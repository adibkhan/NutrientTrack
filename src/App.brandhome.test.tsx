// The sidebar logo is a home button: it returns to the Diary on today's date from any view.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const HOME = /NutrientTrack home: today's diary/

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
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

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}

describe('sidebar logo as home button', () => {
  it('returns to the diary from Settings', async () => {
    const user = await renderApp()
    await user.click(first('Settings'))
    await screen.findByRole('heading', { name: 'Program' })
    expect(screen.queryByRole('region', { name: 'Daily nutrition summary' })).toBeNull()
    await user.click(screen.getByRole('button', { name: HOME }))
    expect(await screen.findByRole('heading', { name: 'Today’s diary' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Daily nutrition summary' })).toBeTruthy()
  })

  it('returns to the diary from Trends', async () => {
    const user = await renderApp()
    await user.click(first('Trends'))
    await screen.findByRole('heading', { name: 'Expenditure' })
    await user.click(screen.getByRole('button', { name: HOME }))
    expect(await screen.findByRole('heading', { name: 'Today’s diary' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Expenditure' })).toBeNull()
  })

  it('resets a past selected date to today', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.queryByRole('heading', { name: 'Today’s diary' })).toBeNull()
    await user.click(first('Foods'))
    expect(screen.queryByRole('heading', { name: 'Today’s diary' })).toBeNull()
    await user.click(screen.getByRole('button', { name: HOME }))
    expect(await screen.findByRole('heading', { name: 'Today’s diary' })).toBeTruthy()
    expect(document.querySelector('.date-pill')?.textContent).toBe('Today')
  })

  it('is not a button on the loading shell but still shows the brand', async () => {
    m.getEntries.mockReturnValue(new Promise(() => undefined))
    render(<App />)
    expect(screen.queryByRole('button', { name: HOME })).toBeNull()
    expect(screen.getByText((_, el) => el?.className === 'brand-name' && el.textContent === 'NutrientTrack')).toBeTruthy()
  })

  it('can be activated from the keyboard with Enter', async () => {
    const user = await renderApp()
    await user.click(first('Settings'))
    await screen.findByRole('heading', { name: 'Program' })
    const logo = screen.getByRole('button', { name: HOME })
    logo.focus()
    expect(document.activeElement).toBe(logo)
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Today’s diary' })).toBeTruthy()
  })
})
