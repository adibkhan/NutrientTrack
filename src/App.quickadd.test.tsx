import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food } from './types'
import { shiftDate, todayISO } from './lib/utils'

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
const at = (hour: number, minute: number) => new Date(2026, 5, 10, hour, minute, 0) // local time

const savedFood: Food = { id: 'f1', name: 'Protein bar', serving: '1 bar', calories: 210, protein: 20, carbs: 22, fat: 7, createdAt: stamp, updatedAt: stamp }
const chicken = (): DiaryEntry => ({
  id: 'old-1', name: 'Chicken breast', meal: 'dinner', date: shiftDate(todayISO(), -1), time: '19:00',
  calories: 248, protein: 46.5, carbs: 0, fat: 5.4, grams: 150, catalogId: 'c1', catalogSource: 'USDA SR Legacy',
  createdAt: stamp, updatedAt: stamp,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(at(8, 15))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([chicken()])
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

const savedEntry = (): DiaryEntry => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry
}

describe('quick add from the Log food sheet', () => {
  it('saves a new entry copying a recent catalog entry snapshot verbatim', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: 'Quick add Chicken breast' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const entry = savedEntry()
    expect(entry.id).toBeTruthy()
    expect(entry.id).not.toBe('old-1')
    expect(entry).toMatchObject({
      name: 'Chicken breast', calories: 248, protein: 46.5, carbs: 0, fat: 5.4,
      grams: 150, catalogId: 'c1', catalogSource: 'USDA SR Legacy', date: todayISO(),
    })
    expect(entry.foodId).toBeUndefined()
    expect(entry.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    expect(m.saveFood).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('saves a saved food with its id and without catalog or grams fields', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Protein bar' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const entry = savedEntry()
    expect(entry).toMatchObject({ name: 'Protein bar', foodId: 'f1', calories: 210, protein: 20, carbs: 22, fat: 7 })
    expect(entry.catalogId).toBeUndefined()
    expect(entry.catalogSource).toBeUndefined()
    expect(entry.grams).toBeUndefined()
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('uses the selected diary day, not today', async () => {
    const user = await renderApp()
    await user.click(first('Previous day'))
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Protein bar' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().date).toBe(shiftDate(todayISO(), -1))
  })

  it('picks the meal from the time of day from the top bar', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Protein bar' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().meal).toBe('breakfast')
  })

  it('keeps the explicit meal when opened from a per-meal Add', async () => {
    const user = await renderApp()
    const dinner = await screen.findByRole('region', { name: 'Dinner' })
    await user.click(within(dinner).getByRole('button', { name: 'Add' }))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Protein bar' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().meal).toBe('dinner')
  })

  it('shows the error toast, keeps the sheet open and re-enables buttons when the save fails', async () => {
    m.saveEntry.mockRejectedValue(new Error('disk full'))
    m.getFoods.mockResolvedValue([savedFood, { ...savedFood, id: 'f2', name: 'Protein bar 2' }])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Protein bar' }))
    expect(await screen.findByText('That entry could not be saved. Try again.')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    await waitFor(() => {
      for (const button of within(dialog).getAllByRole('button', { name: /^Quick add / })) {
        expect(button).toHaveProperty('disabled', false)
      }
    })
    expect(within(dialog).getAllByRole('button', { name: /^Quick add / }).length).toBeGreaterThan(1)
  })

  it('saves only once when quick add is tapped twice while the save is in flight', async () => {
    let resolveSave: () => void = () => undefined
    m.saveEntry.mockReturnValue(new Promise<void>((resolve) => { resolveSave = resolve }))
    m.getFoods.mockResolvedValue([savedFood, { ...savedFood, id: 'f2', name: 'Protein bar 2' }])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    const same = await screen.findByRole('button', { name: 'Quick add Protein bar' })
    const other = screen.getByRole('button', { name: 'Quick add Protein bar 2' })
    await user.click(same)
    await waitFor(() => expect(same).toHaveProperty('disabled', true))
    expect(other).toHaveProperty('disabled', true)
    await user.click(same)
    await user.click(other)
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
    resolveSave()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
  })

  it('quick adds a recent entry found through a typed query', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.type(await screen.findByPlaceholderText(/Search foods/), 'chick')
    await user.click(await screen.findByRole('button', { name: 'Quick add Chicken breast' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const entry = savedEntry()
    expect(entry.id).not.toBe('old-1')
    expect(entry).toMatchObject({ name: 'Chicken breast', calories: 248, protein: 46.5, grams: 150, catalogId: 'c1', date: todayISO() })
    expect(m.saveFood).not.toHaveBeenCalled()
  })
})
