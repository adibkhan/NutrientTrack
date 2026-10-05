import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food } from './types'

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
const savedFood: Food = { id: 'f1', name: 'Greek yogurt', serving: '1 cup', calories: 150, protein: 15, carbs: 8, fat: 4, createdAt: stamp, updatedAt: stamp }
const recentEntry: DiaryEntry = {
  id: 'e1', name: 'Porridge', meal: 'breakfast', date: '2026-06-09', calories: 300,
  protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp,
}

const at = (hour: number, minute: number) => new Date(2026, 5, 10, hour, minute, 0) // local time

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(at(8, 15))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([recentEntry])
  m.getFoods.mockResolvedValue([savedFood])
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

async function renderApp(user: User = setup()) {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}

const destinationMeal = async () => {
  const group = await screen.findByRole('radiogroup', { name: 'Destination meal' })
  const checked = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((radio) => radio.checked)
  expect(checked).toHaveLength(1)
  return checked[0].value
}

describe('logger defaults the meal from the time of day', () => {
  it('defaults to breakfast at 08:15 when logging from the top bar', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(await destinationMeal()).toBe('breakfast')
  })

  it('defaults to dinner at 19:30 when logging from the top bar', async () => {
    vi.setSystemTime(at(19, 30))
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(await destinationMeal()).toBe('dinner')
  })

  it('defaults a saved food quick log to the time-based meal', async () => {
    vi.setSystemTime(at(19, 30))
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Log' }))
    expect(await destinationMeal()).toBe('dinner')
  })

  it('keeps lunch when the per-meal Add for Lunch is used at 08:15', async () => {
    const user = await renderApp()
    const lunch = await screen.findByRole('region', { name: 'Lunch' })
    await user.click(within(lunch).getByRole('button', { name: 'Add' }))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(await destinationMeal()).toBe('lunch')
  })
})

describe('logger search results omit empty groups', () => {
  const search = async (user: User, text: string) => {
    await user.click(first('Log food'))
    await user.type(await screen.findByPlaceholderText(/Search foods/), text)
  }

  it('shows no recent or saved group when the query matches neither', async () => {
    const user = await renderApp()
    await search(user, 'zzzzqq')
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('USDA catalog')
    expect(within(dialog).queryByText(/No recent diary entries match/)).toBeNull()
    expect(within(dialog).queryByText(/No saved foods match/)).toBeNull()
    expect(within(dialog).queryByText('Recent entries')).toBeNull()
    expect(within(dialog).queryByText('Saved foods')).toBeNull()
  })

  it('shows the Saved foods group with the food when the query matches a saved food', async () => {
    const user = await renderApp()
    await search(user, 'yogurt')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Saved foods')).toBeTruthy()
    expect(within(dialog).getByText('Greek yogurt')).toBeTruthy()
    expect(within(dialog).queryByText('Recent entries')).toBeNull()
    expect(within(dialog).getByText('USDA catalog')).toBeTruthy()
  })
})
