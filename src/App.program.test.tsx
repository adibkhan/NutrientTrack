// Program, expenditure and weekly check-in at the App level: what the Trends and Settings views show, and what gets saved.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings, WeightEntry } from './types'
import { shiftDate, todayISO } from './lib/utils'
import { lastCheckInDate } from './lib/program'

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
const today = todayISO()
const weekday = new Date().getDay()
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

let seq = 0
const eaten = (date: string, calories: number): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp })
const weigh = (date: string, weight: number): WeightEntry => ({ id: `w-${date}`, date, weight, unit: 'lb', createdAt: stamp })

/** 40 days of 2300 kcal and a flat 180 lb every third day: expenditure reads 2300. */
const steadyEntries = () => Array.from({ length: 40 }, (_, i) => eaten(shiftDate(today, -i), 2300))
const steadyWeights = () => Array.from({ length: 16 }, (_, i) => weigh(shiftDate(today, -i * 3), 180))

const settingsRecord = (program: unknown): Settings =>
  ({
    id: 'profile', goals: { weightUnit: 'lb', calories: 2000, protein: 150 }, preferences: { theme: 'light' },
    futureTopLevel: { keep: 'me' }, program, updatedAt: stamp,
  }) as unknown as Settings

// A program that is due for a check-in today: lose 1 lb a week, check-in day is today's weekday, never checked in.
const dueProgram = (extra: Record<string, unknown> = {}) => ({ direction: 'lose', weeklyRate: 1, checkInDay: weekday, futureField: 'pf', ...extra })

let stored: Settings | undefined

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  stored = undefined
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockImplementation(async () => stored)
  m.saveSettings.mockResolvedValue(undefined)
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
async function openTrends() {
  const user = userEvent.setup()
  await renderApp()
  await user.click(first('Trends'))
  await screen.findByRole('heading', { name: 'Expenditure' })
  return user
}
async function openSettings() {
  const user = userEvent.setup()
  await renderApp()
  await user.click(first('Settings'))
  await screen.findByRole('heading', { name: 'Program' })
  return user
}
const savedSettings = () => m.saveSettings.mock.calls.at(-1)?.[0] as unknown as Record<string, any>

describe('Trends: expenditure card', () => {
  it('says there is not enough data, with the reason, for an empty diary', async () => {
    await openTrends()
    expect(screen.getByText('Not enough data yet')).toBeTruthy()
    expect(screen.getByText(/Log food on at least 14 of the last 28 days. You have 0./)).toBeTruthy()
  })

  it('shows a kcal per day figure when the data supports one', async () => {
    m.getEntries.mockResolvedValue(steadyEntries())
    m.getWeights.mockResolvedValue(steadyWeights())
    await openTrends()
    expect(screen.queryByText('Not enough data yet')).toBeNull()
    expect(screen.getByText(/^2,?300/, { selector: '.metric-value' })).toBeTruthy()
    expect(screen.getByText('kcal / day')).toBeTruthy()
  })
})

describe('Trends: weekly check-in', () => {
  it('is hidden when no program is set', async () => {
    stored = settingsRecord(undefined)
    await openTrends()
    expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull()
  })

  it('is hidden without a check-in day', async () => {
    stored = settingsRecord({ direction: 'lose', weeklyRate: 1 })
    await openTrends()
    expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull()
  })

  it('is hidden when this week is already checked in', async () => {
    stored = settingsRecord(dueProgram({ lastCheckIn: lastCheckInDate(today, weekday) }))
    await openTrends()
    expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull()
  })

  it('shows when the program has never been checked in', async () => {
    stored = settingsRecord(dueProgram())
    await openTrends()
    expect(screen.getByRole('heading', { name: 'Weekly check-in' })).toBeTruthy()
  })

  it('shows when the last check-in is old', async () => {
    stored = settingsRecord(dueProgram({ lastCheckIn: shiftDate(today, -14) }))
    await openTrends()
    expect(screen.getByRole('heading', { name: 'Weekly check-in' })).toBeTruthy()
  })

  it('accepts the new budget while keeping every other field on the stored record', async () => {
    stored = settingsRecord(dueProgram())
    m.getEntries.mockResolvedValue(steadyEntries())
    m.getWeights.mockResolvedValue(steadyWeights())
    const user = await openTrends()
    await user.click(screen.getByRole('button', { name: /Accept new budget/ }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = savedSettings()
    expect(saved.goals).toEqual({ weightUnit: 'lb', calories: 1800, protein: 150 })
    expect(saved.program.lastCheckIn).toBe(lastCheckInDate(today, weekday))
    expect(saved.program).toMatchObject({ direction: 'lose', weeklyRate: 1, checkInDay: weekday, futureField: 'pf' })
    expect(saved.futureTopLevel).toEqual({ keep: 'me' })
    expect(saved.preferences).toEqual({ theme: 'light' })
    expect(saved.id).toBe('profile')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull())
  })

  it('keeps the current budget but records the check-in', async () => {
    stored = settingsRecord(dueProgram())
    m.getEntries.mockResolvedValue(steadyEntries())
    m.getWeights.mockResolvedValue(steadyWeights())
    const user = await openTrends()
    await user.click(screen.getByRole('button', { name: 'Keep current budget' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = savedSettings()
    expect(saved.goals).toEqual({ weightUnit: 'lb', calories: 2000, protein: 150 })
    expect(saved.program.lastCheckIn).toBe(lastCheckInDate(today, weekday))
    expect(saved.program.futureField).toBe('pf')
    expect(saved.futureTopLevel).toEqual({ keep: 'me' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull())
  })

  it('cannot accept when there is not enough data for a new budget', async () => {
    stored = settingsRecord(dueProgram())
    await openTrends()
    expect((screen.getByRole('button', { name: /Accept new budget/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Settings: Program panel', () => {
  it('replaces only the form-owned fields and keeps unknown fields and lastCheckIn', async () => {
    stored = settingsRecord({ direction: 'gain', goalWeight: 150, weeklyRate: 1, checkInDay: 2, futureField: 'x', lastCheckIn: '2026-03-01' })
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Lose' }))
    const goal = screen.getByLabelText(/Goal weight/)
    await user.clear(goal)
    await user.type(goal, '170')
    const rate = screen.getByLabelText(/^Rate/)
    await user.clear(rate)
    await user.type(rate, '0.5')
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = savedSettings()
    expect(saved.program).toEqual({ direction: 'lose', goalWeight: 170, weeklyRate: 0.5, checkInDay: 2, futureField: 'x', lastCheckIn: '2026-03-01' })
    expect(saved.goals).toEqual({ weightUnit: 'lb', calories: 2000, protein: 150 })
    expect(saved.futureTopLevel).toEqual({ keep: 'me' })
    expect(saved.preferences).toEqual({ theme: 'light' })
  })

  it('removes a form-owned field the user cleared without touching unknown ones', async () => {
    stored = settingsRecord({ direction: 'maintain', goalWeight: 150, futureField: 'x' })
    const user = await openSettings()
    await user.clear(screen.getByLabelText(/Goal weight/))
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().program).toEqual({ direction: 'maintain', futureField: 'x' })
  })

  it('rejects a goal weight of zero and does not save', async () => {
    stored = settingsRecord({ direction: 'maintain' })
    const user = await openSettings()
    await user.type(screen.getByLabelText(/Goal weight/), '0')
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Goal weight must be a number greater than zero/)
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('rejects a negative goal weight and does not save', async () => {
    stored = settingsRecord({ direction: 'maintain' })
    const user = await openSettings()
    fireEvent.change(screen.getByLabelText(/Goal weight/), { target: { value: '-5' } })
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    // The input has min=0, so the browser's own validation blocks the submit before the custom message can show; either way nothing is saved.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('rejects losing without a rate and does not save', async () => {
    stored = settingsRecord({})
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Lose' }))
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/weekly rate/)
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('sets the daily budget from the estimate and keeps the other goals', async () => {
    stored = settingsRecord({ direction: 'lose', weeklyRate: 1, futureField: 'pf' })
    m.getEntries.mockResolvedValue(steadyEntries())
    m.getWeights.mockResolvedValue(steadyWeights())
    const user = await openSettings()
    await user.click(await screen.findByRole('button', { name: /Set my daily budget to 1,?800 kcal/ }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = savedSettings()
    expect(saved.goals).toEqual({ weightUnit: 'lb', calories: 1800, protein: 150 })
    expect(saved.program).toEqual({ direction: 'lose', weeklyRate: 1, futureField: 'pf' })
    expect(saved.futureTopLevel).toEqual({ keep: 'me' })
  })

  it('offers no budget button when there is no estimate', async () => {
    stored = settingsRecord({ direction: 'lose', weeklyRate: 1 })
    await openSettings()
    expect(screen.queryByRole('button', { name: /Set my daily budget/ })).toBeNull()
    expect(m.saveSettings).not.toHaveBeenCalled()
  })
})

describe('junk program on the stored settings record', () => {
  const notSet = () => {
    for (const name of ['Lose', 'Maintain', 'Gain']) expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByLabelText('Check-in day') as HTMLSelectElement).value).toBe('')
  }

  it.each([['a string', 'x'], ['an invalid direction and day', { direction: 'fly', checkInDay: 9 }], ['an array', [1, 2]]])(
    'renders Settings without crashing and as not set when program is %s',
    async (_label, program) => {
      stored = settingsRecord(program)
      await openSettings()
      notSet()
    },
  )

  it.each([['a string', 'x'], ['an invalid direction and day', { direction: 'fly', checkInDay: 9 }]])(
    'renders Trends without a check-in card when program is %s',
    async (_label, program) => {
      stored = settingsRecord(program)
      await openTrends()
      expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull()
    },
  )

  it('does not turn a junk string program into character keys when the form is saved', async () => {
    stored = settingsRecord('x')
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Maintain' }))
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().program).toEqual({ direction: 'maintain' })
  })
})
