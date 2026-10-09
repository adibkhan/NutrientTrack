// Update banner: Later, hiding behind modals, and a second controllerchange after a first install.
import { act, cleanup, render, screen } from '@testing-library/react'
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
const BANNER = 'A new version of NutrientTrack is ready.'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

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
})

afterEach(() => {
  cleanup()
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

function stubWorker(controller: unknown) {
  const sw = Object.assign(new EventTarget(), { controller, register: vi.fn(() => Promise.resolve()) })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
  return sw
}
const fire = (sw: EventTarget) => act(() => { sw.dispatchEvent(new Event('controllerchange')) })
async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}

describe('update banner dismissal and timing', () => {
  it('hides_when_Later_is_pressed', async () => {
    const sw = stubWorker({})
    const user = await renderApp()
    await fire(sw)
    expect(screen.getByText(BANNER)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('is_hidden_while_a_modal_is_open_and_returns_when_it_closes', async () => {
    const sw = stubWorker({})
    const user = await renderApp()
    await fire(sw)
    expect(screen.getByText(BANNER)).toBeTruthy()
    await user.click(first('Log food'))
    await screen.findByRole('dialog')
    expect(screen.queryByText(BANNER)).toBeNull()
    await user.keyboard('{Escape}')
    if (screen.queryByRole('dialog')) await user.click(screen.getByRole('button', { name: /close|cancel/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(BANNER)).toBeTruthy()
  })

  it('stays_hidden_after_Later_even_once_a_modal_has_come_and_gone', async () => {
    const sw = stubWorker({})
    const user = await renderApp()
    await fire(sw)
    await user.click(screen.getByRole('button', { name: 'Later' }))
    await user.click(first('Log food'))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('shows_on_a_second_controllerchange_after_a_first_install_with_no_prior_controller', async () => {
    const sw = stubWorker(null)
    await renderApp()
    await fire(sw)
    expect(screen.queryByText(BANNER)).toBeNull()
    await fire(sw)
    expect(screen.getByText(BANNER)).toBeTruthy()
  })
})
