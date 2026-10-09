import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  const target = new EventTarget()
  const add = vi.spyOn(target, 'addEventListener')
  const remove = vi.spyOn(target, 'removeEventListener')
  const sw = Object.assign(target, { controller, register: vi.fn(() => Promise.resolve()) })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
  return { sw, add, remove }
}
const fire = (sw: EventTarget) => act(() => { sw.dispatchEvent(new Event('controllerchange')) })
async function renderApp() {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
}

describe('update banner', () => {
  it('appears with a Reload button when a new worker takes over an already controlled page', async () => {
    const { sw } = stubWorker({})
    await renderApp()
    expect(screen.queryByText(BANNER)).toBeNull()
    await fire(sw)
    expect(screen.getByText(BANNER).closest('[role="status"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('reloads the page when Reload is pressed', async () => {
    const { sw } = stubWorker({})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await renderApp()
    await fire(sw)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('shows nothing on first install, when there was no controller at mount', async () => {
    const { sw } = stubWorker(null)
    await renderApp()
    await fire(sw)
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('removes its controllerchange listener on unmount', async () => {
    const { add, remove } = stubWorker({})
    await renderApp()
    const added = add.mock.calls.filter(([type]) => type === 'controllerchange').map(([, fn]) => fn)
    expect(added.length).toBeGreaterThan(0)
    cleanup()
    const removed = remove.mock.calls.filter(([type]) => type === 'controllerchange').map(([, fn]) => fn)
    for (const fn of added) expect(removed).toContain(fn)
  })
})
