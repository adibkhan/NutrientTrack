// Past-date defaults: a new entry for a day that is not today gets no time and the "other" meal unless opened from a meal section.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food } from './types'

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
const yogurt = { id: 'f-1', name: 'Yogurt', serving: '1 cup', calories: 200, protein: 10, carbs: 20, fat: 6, createdAt: stamp, updatedAt: stamp } as Food

beforeEach(() => {
  // Wednesday 2026-06-10 08:15 local: breakfast by the clock.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 5, 10, 8, 15, 0))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([yogurt])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function renderApp() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
type User = Awaited<ReturnType<typeof renderApp>>

const goBackOneDay = (user: User) => user.click(screen.getByRole('button', { name: 'Previous day' }))
const saved = () => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry
}
const checkedMeal = () => (screen.getByRole('radiogroup', { name: 'Destination meal' }).querySelector('input:checked') as HTMLInputElement).value

async function openManual(user: User) {
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
}
async function fillAndSave(user: User) {
  await user.type(screen.getByLabelText('Food or meal name'), 'Toast')
  await user.type(screen.getByLabelText(/^Calories/), '120')
  await user.click(screen.getByRole('button', { name: 'Add to diary' }))
}
async function quickAdd(user: User) {
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('tab', { name: /My foods/ }))
  await user.click(await screen.findByRole('button', { name: 'Quick add Yogurt' }))
  await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
}

describe('manual Log food on a past day', () => {
  it('starts with no time and the other meal', async () => {
    const user = await renderApp()
    await goBackOneDay(user)
    await openManual(user)
    expect((screen.getByLabelText(/Local time/) as HTMLInputElement).value).toBe('')
    expect(checkedMeal()).toBe('other')
  })

  it('saves no time key, meal other and the viewed date', async () => {
    const user = await renderApp()
    await goBackOneDay(user)
    await openManual(user)
    await fillAndSave(user)
    const result = saved()
    expect(result).not.toHaveProperty('time')
    expect(result.meal).toBe('other')
    expect(result.date).toBe('2026-06-09')
  })

  it('uses the meal of the section it was opened from', async () => {
    const user = await renderApp()
    await goBackOneDay(user)
    await user.click(screen.getAllByRole('button', { name: 'Add' })[1])
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(checkedMeal()).toBe('lunch')
    expect((screen.getByLabelText(/Local time/) as HTMLInputElement).value).toBe('')
    await fillAndSave(user)
    expect(saved().meal).toBe('lunch')
    expect(saved()).not.toHaveProperty('time')
  })
})

describe('manual Log food today', () => {
  it('uses the current time and guesses the meal from it', async () => {
    const user = await renderApp()
    await openManual(user)
    expect((screen.getByLabelText(/Local time/) as HTMLInputElement).value).toBe('08:15')
    expect(checkedMeal()).toBe('breakfast')
    await fillAndSave(user)
    expect(saved()).toMatchObject({ time: '08:15', meal: 'breakfast', date: '2026-06-10' })
  })

  it('lets a meal section override the guessed meal', async () => {
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Add' })[2])
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(checkedMeal()).toBe('dinner')
    expect((screen.getByLabelText(/Local time/) as HTMLInputElement).value).toBe('08:15')
  })
})

describe('quick-add', () => {
  it('on a past day saves no time key and meal other', async () => {
    const user = await renderApp()
    await goBackOneDay(user)
    await quickAdd(user)
    const result = saved()
    expect(result).not.toHaveProperty('time')
    expect(result).toMatchObject({ meal: 'other', date: '2026-06-09', name: 'Yogurt' })
  })

  it('on a past day from a meal section uses that meal', async () => {
    const user = await renderApp()
    await goBackOneDay(user)
    await user.click(screen.getAllByRole('button', { name: 'Add' })[3])
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Yogurt' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved().meal).toBe('snack')
    expect(saved()).not.toHaveProperty('time')
  })

  it('today saves the current time and the guessed meal', async () => {
    const user = await renderApp()
    await quickAdd(user)
    expect(saved()).toMatchObject({ time: '08:15', meal: 'breakfast', date: '2026-06-10' })
  })

  it('today at 13:40 guesses lunch', async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 13, 40, 0))
    const user = await renderApp()
    await quickAdd(user)
    expect(saved()).toMatchObject({ time: '13:40', meal: 'lunch' })
  })
})
