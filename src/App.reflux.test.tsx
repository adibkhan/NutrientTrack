// The heartburn log under the water line and the trigger finder on Trends, both only with reflux watch on.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings, Symptom } from './types'
import { shiftDate, todayISO } from './lib/utils'

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
const today = todayISO()
const stamp = '2026-01-01T00:00:00.000Z'
let seq = 0
const entry = (date: string, name: string, time: string): DiaryEntry => ({ id: `e-${seq++}`, date, meal: 'lunch', name, calories: 100, protein: 1, carbs: 1, fat: 1, time, createdAt: stamp, updatedAt: stamp })
const flare = (date: string, time: string, severity: Symptom['severity'] = 2): Symptom => ({ id: `s-${seq++}`, date, time, kind: 'heartburn', severity, createdAt: stamp, updatedAt: stamp })
const settings = (preferences: Record<string, unknown>): Settings => ({ id: 'profile', goals: { weightUnit: 'lb' }, preferences, updatedAt: stamp } as Settings)

let entries: DiaryEntry[]
let symptoms: Symptom[]
beforeEach(() => {
  entries = []
  symptoms = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockImplementation(async () => entries)
  m.getSymptoms.mockImplementation(async () => symptoms)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(settings({ welcomed: true, refluxWatch: true }))
  m.saveSymptom.mockImplementation(async (symptom) => { symptoms = [...symptoms, symptom] })
  m.deleteSymptom.mockImplementation(async (id) => { symptoms = symptoms.filter((symptom) => symptom.id !== id) })
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
const heartburnLog = () => screen.queryByLabelText('Heartburn log')

describe('heartburn log on the diary', () => {
  it('is_hidden_unless_reflux_watch_is_on', async () => {
    m.getSettings.mockResolvedValue(settings({ welcomed: true }))
    await renderApp()
    expect(heartburnLog()).toBeNull()
  })

  it('logs_a_flare_with_the_time_and_removes_it_again', async () => {
    vi.setSystemTime(new Date(`${today}T14:05:00`))
    const user = await renderApp()
    const log = heartburnLog()!
    expect(within(log).getByText('None today')).toBeTruthy()
    await user.click(within(log).getByRole('button', { name: 'Log heartburn' }))
    await user.click(within(log).getByRole('button', { name: 'Moderate' }))
    expect(m.saveSymptom).toHaveBeenCalledWith(expect.objectContaining({ date: today, time: '14:05', kind: 'heartburn', severity: 2 }))
    expect(await screen.findByText('Moderate heartburn logged. Hope it eases soon.')).toBeTruthy()
    const chip = await within(heartburnLog()!).findByRole('button', { name: /Remove moderate heartburn at/ })
    const savedId = symptoms[0].id
    await user.click(chip)
    expect(m.deleteSymptom).toHaveBeenCalledWith(savedId)
    expect(await within(heartburnLog()!).findByText('None today')).toBeTruthy()
    vi.useRealTimers()
  })

  it('leaves_the_time_off_when_logged_on_a_past_day', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(within(heartburnLog()!).getByRole('button', { name: 'Log heartburn' }))
    await user.click(within(heartburnLog()!).getByRole('button', { name: 'Severe' }))
    expect(m.saveSymptom).toHaveBeenCalledWith(expect.objectContaining({ date: shiftDate(today, -1), severity: 3 }))
    expect(m.saveSymptom.mock.calls[0][0].time).toBeUndefined()
  })
})

describe('trigger finder on Trends', () => {
  const openTrends = async () => {
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Trends' })[0])
    await screen.findByRole('heading', { name: 'Body measurements' })
    return user
  }

  it('is_hidden_without_reflux_watch_and_waits_for_enough_flares', async () => {
    m.getSettings.mockResolvedValue(settings({ welcomed: true }))
    await openTrends()
    expect(screen.queryByRole('heading', { name: 'Heartburn' })).toBeNull()
    cleanup()
    m.getSettings.mockResolvedValue(settings({ welcomed: true, refluxWatch: true }))
    symptoms = [flare(today, '09:30'), flare(shiftDate(today, -1), '09:30')]
    await openTrends()
    const card = screen.getByRole('region', { name: 'Heartburn over the last 30 days' })
    expect(within(card).getByText('2 flares')).toBeTruthy()
    expect(within(card).getByText(/3 more flares to go/)).toBeTruthy()
  })

  it('names_the_trigger_that_comes_before_flares', async () => {
    const days = Array.from({ length: 10 }, (_, index) => shiftDate(today, -index))
    entries = days.flatMap((date, index) => [entry(date, 'Rice', '12:00'), ...(index < 5 ? [entry(date, 'Black coffee', '08:00')] : [])])
    symptoms = days.slice(0, 5).map((date) => flare(date, '09:30'))
    await openTrends()
    const card = screen.getByRole('region', { name: 'Heartburn over the last 30 days' })
    expect(within(card).getByText('Coffee').closest('li')?.textContent).toContain('came before 5 of 5 flares')
    expect(within(card).getByText('You have it on 50% of logged days')).toBeTruthy()
    expect(within(card).queryByText(/Rice/)).toBeNull()
  })
})
