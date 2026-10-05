// Switching the weight unit converts the program with the trend, and the Trends "To goal" tile.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, WeightEntry } from './types'
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
const today = todayISO()
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const weigh = (date: string, weight: number): WeightEntry => ({ id: `w-${date}`, date, weight, unit: 'lb', createdAt: stamp })
const flat180 = () => [0, 1, 2].map((i) => weigh(shiftDate(today, -i), 180))

const settingsRecord = (program: unknown, goals: Record<string, unknown> = { weightUnit: 'lb', calories: 2000, protein: 150, carbs: 200, fat: 60 }): Settings =>
  ({ id: 'profile', goals, preferences: { theme: 'light' }, futureTopLevel: { keep: 'me' }, program, updatedAt: stamp }) as unknown as Settings

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
const tile = () => document.querySelector('.goal-tile') as HTMLElement | null

const loseProgram = () => ({ direction: 'lose', goalWeight: 170, weeklyRate: 1, proteinPerWeight: 0.8, checkInDay: 2, lastCheckIn: '2026-03-01', futureProgramField: { keep: 'me' } })

describe('Settings: switching the weight unit', () => {
  it('converts goal weight, rate and protein ratio and keeps every other field', async () => {
    stored = settingsRecord(loseProgram())
    m.getWeights.mockResolvedValue(flat180())
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Weight unit'), 'kg')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = savedSettings()
    expect(saved.goals).toEqual({ weightUnit: 'kg', calories: 2000, protein: 150, carbs: 200, fat: 60 })
    expect(saved.program).toEqual({ direction: 'lose', goalWeight: 77.1, weeklyRate: 0.45, proteinPerWeight: 1.76, checkInDay: 2, lastCheckIn: '2026-03-01', futureProgramField: { keep: 'me' } })
    expect(saved.futureTopLevel).toEqual({ keep: 'me' })
    expect(saved.preferences).toEqual({ theme: 'light' })
    expect(saved.id).toBe('profile')
  })

  it('leaves the program untouched when goals are saved without changing the unit', async () => {
    stored = settingsRecord(loseProgram())
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().program).toEqual(loseProgram())
    expect(savedSettings().goals.weightUnit).toBe('lb')
  })

  it('does not invent a program when the record has none', async () => {
    stored = settingsRecord(undefined)
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Weight unit'), 'kg')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().goals.weightUnit).toBe('kg')
    expect(savedSettings().program).toBeUndefined()
  })

  it('saves a junk string program without crashing and without turning it into an object', async () => {
    stored = settingsRecord('x')
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Weight unit'), 'kg')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().goals.weightUnit).toBe('kg')
    expect(savedSettings().program).toBe('x')
  })

  it('shows the Trends tile as an amount to go in kg, not Reached, after the switch', async () => {
    stored = settingsRecord(loseProgram())
    m.getWeights.mockResolvedValue(flat180())
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Weight unit'), 'kg')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    await user.click(first('Trends'))
    await screen.findByRole('heading', { name: 'Expenditure' })
    expect(tile()?.textContent).toContain('To goal')
    expect(tile()?.textContent).toMatch(/4\.5 kg/)
    expect(tile()?.textContent).not.toContain('Reached')
  })
})

describe('Trends: To goal tile', () => {
  it('shows the remaining weight with the unit when a goal and a weigh-in exist', async () => {
    stored = settingsRecord({ direction: 'lose', goalWeight: 170 })
    m.getWeights.mockResolvedValue(flat180())
    await openTrends()
    expect(tile()?.textContent).toContain('To goal')
    expect(tile()?.textContent).toContain('10 lb')
    expect(tile()?.textContent).not.toContain(' · by ')
  })

  it('shows Reached when the trend is past the goal', async () => {
    stored = settingsRecord({ direction: 'lose', goalWeight: 185, weeklyRate: 1 })
    m.getWeights.mockResolvedValue(flat180())
    await openTrends()
    expect(tile()?.textContent).toContain('Reached')
  })

  it('adds a projected date with a year when a weekly rate is set', async () => {
    stored = settingsRecord({ direction: 'lose', goalWeight: 170, weeklyRate: 1 })
    m.getWeights.mockResolvedValue(flat180())
    await openTrends()
    expect(tile()?.textContent).toMatch(/10 lb · by .*\d{4}/)
  })

  it('is hidden without a goal weight', async () => {
    stored = settingsRecord({ direction: 'lose', weeklyRate: 1 })
    m.getWeights.mockResolvedValue(flat180())
    await openTrends()
    expect(tile()).toBeNull()
  })

  it('is hidden without a direction', async () => {
    stored = settingsRecord({ goalWeight: 170, weeklyRate: 1 })
    m.getWeights.mockResolvedValue(flat180())
    await openTrends()
    expect(tile()).toBeNull()
  })

  it('is hidden without weigh-ins', async () => {
    stored = settingsRecord({ direction: 'lose', goalWeight: 170, weeklyRate: 1 })
    await openTrends()
    expect(tile()).toBeNull()
  })

  it('is still shown when the chart window holds fewer than two entries', async () => {
    stored = settingsRecord({ direction: 'lose', goalWeight: 170 })
    m.getWeights.mockResolvedValue([weigh(today, 180)])
    await openTrends()
    expect(screen.getByText('Add one more check-in.')).toBeTruthy()
    expect(tile()?.textContent).toContain('10 lb')
  })

  it('is still shown when the only weigh-in is older than the chart window', async () => {
    stored = settingsRecord({ direction: 'lose', goalWeight: 170 })
    m.getWeights.mockResolvedValue([weigh(shiftDate(today, -60), 180)])
    await openTrends()
    expect(screen.getByText('No weight entries in this window.')).toBeTruthy()
    expect(tile()?.textContent).toContain('10 lb')
  })
})
