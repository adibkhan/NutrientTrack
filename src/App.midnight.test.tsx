import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from './types'
import { formatShortDate } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(),
  deleteFood: vi.fn(),
  deleteWeight: vi.fn(),
  exportBackup: vi.fn(),
  clearAllData: vi.fn(),
  getEntries: vi.fn(),
  getFoods: vi.fn(),
  getSettings: vi.fn(),
  getWeights: vi.fn(),
  importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(),
  saveEntry: vi.fn(),
  saveFood: vi.fn(),
  saveSettings: vi.fn(),
  saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const DAY = '2026-06-10'
const NEXT = '2026-06-11'
const mk = (id: string, name: string, date: string): DiaryEntry => ({
  id, name, meal: 'breakfast', date, calories: 300, protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp,
})
const entries = [
  mk('a', 'Entry on D', DAY),
  mk('b', 'Entry on D+1', NEXT),
  mk('c', 'Entry on D-3', '2026-06-07'),
  mk('d', 'Entry on D-1', '2026-06-09'),
]

const late = () => new Date(2026, 5, 10, 23, 59, 30) // local time, 30s before midnight
const pastMidnight = () => new Date(2026, 5, 11, 0, 0, 30)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(late())
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue(entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

type User = ReturnType<typeof userEvent.setup>
const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const pill = () => (document.querySelector('.date-pill') as HTMLElement).textContent

async function renderApp(user: User = setup()) {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await screen.findByText('Entry on D')
  return user
}

// Jump the clock past local midnight without firing any timers.
const crossMidnight = () => { vi.setSystemTime(pastMidnight()) }
const fireFocus = () => act(() => { window.dispatchEvent(new Event('focus')) })

async function openWeightDialog(user: User) {
  await user.click(first('Trends'))
  await user.click(first('Log weight'))
  return screen.findByRole('dialog')
}

describe('midnight rollover of "today"', () => {
  it('moves Today to the new day after the 60s interval tick when viewing today', async () => {
    await renderApp()
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D')).toBeTruthy()
    // 30s of fake time left before midnight; a 60s advance crosses it and fires the interval.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(new Date().getDate()).toBe(11)
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D+1')).toBeTruthy()
    expect(screen.queryByText('Entry on D')).toBeNull()
  })

  it('moves Today to the new day on visibilitychange without a timer tick', async () => {
    await renderApp()
    crossMidnight()
    expect(screen.getByText('Entry on D')).toBeTruthy()
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D+1')).toBeTruthy()
    expect(screen.queryByText('Entry on D')).toBeNull()
  })

  it('moves Today to the new day on window focus without a timer tick', async () => {
    await renderApp()
    crossMidnight()
    fireFocus()
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D+1')).toBeTruthy()
    expect(screen.queryByText('Entry on D')).toBeNull()
  })

  it('leaves the view alone when focus fires but the day has not changed', async () => {
    await renderApp()
    fireFocus()
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D')).toBeTruthy()
  })

  it('keeps a past day (D-3) selected across rollover, and Back to today then goes to the new day', async () => {
    const user = await renderApp()
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(pill()).toBe(formatShortDate('2026-06-07'))
    expect(screen.getByText('Entry on D-3')).toBeTruthy()
    crossMidnight()
    fireFocus()
    expect(pill()).toBe(formatShortDate('2026-06-07'))
    expect(screen.getByText('Entry on D-3')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back to today' }))
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D+1')).toBeTruthy()
  })

  it('keeps yesterday selected when the rollover event fires twice in a row', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    crossMidnight()
    fireFocus()
    fireFocus()
    expect(pill()).toBe(formatShortDate('2026-06-09'))
    expect(screen.getByText('Entry on D-1')).toBeTruthy()
  })

  it('keeps an explicitly chosen D+1 selected across rollover and then labels it Today', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(pill()).toBe(formatShortDate(NEXT))
    crossMidnight()
    fireFocus()
    expect(pill()).toBe('Today')
    expect(screen.getByText('Entry on D+1')).toBeTruthy()
  })
})

describe('Log weight default date', () => {
  it('defaults to the current day when opened at load', async () => {
    const user = await renderApp()
    const dialog = await openWeightDialog(user)
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe(DAY)
  })

  it('defaults to the new day when opened after rollover', async () => {
    const user = await renderApp()
    crossMidnight()
    fireFocus()
    const dialog = await openWeightDialog(user)
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe(NEXT)
  })
})

describe('listener cleanup', () => {
  it('removes the same listeners and clears the interval on unmount', () => {
    const docAdd = vi.spyOn(document, 'addEventListener')
    const docRemove = vi.spyOn(document, 'removeEventListener')
    const winAdd = vi.spyOn(window, 'addEventListener')
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const clear = vi.spyOn(window, 'clearInterval')
    const view = render(<App />)
    const vis = docAdd.mock.calls.find((c) => c[0] === 'visibilitychange')?.[1]
    const focus = winAdd.mock.calls.find((c) => c[0] === 'focus')?.[1]
    expect(vis).toBeTruthy()
    expect(focus).toBeTruthy()
    view.unmount()
    expect(docRemove.mock.calls.some((c) => c[0] === 'visibilitychange' && c[1] === vis)).toBe(true)
    expect(winRemove.mock.calls.some((c) => c[0] === 'focus' && c[1] === focus)).toBe(true)
    expect(clear).toHaveBeenCalled()
  })
})

describe('EntryModal double submit', () => {
  it('calls saveEntry exactly once for repeated submits while saving', async () => {
    let release: () => void = () => {}
    m.saveEntry.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Food or meal name'), 'Toast')
    await user.type(within(dialog).getByLabelText(/^Calories/), '120')
    const form = dialog.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
  })
})
