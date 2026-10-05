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

const food = (id: string, name: string, extra: Partial<Food> = {}): Food => ({ id, name, serving: '1 serving', calories: 100, protein: 5, carbs: 10, fat: 2, createdAt: stamp, updatedAt: stamp, ...extra })
const recipe = (id: string, name: string): Food => food(id, name, { ingredients: [{ name: 'Oats', calories: 100, protein: 5, carbs: 10, fat: 2 }], recipeServings: 2 })
// Higher n means more recently updated, so it sorts first in Recent.
const entry = (n: number, name: string, extra: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: `e${n}`, name, meal: 'dinner', date: shiftDate(todayISO(), -1), time: '19:00',
  calories: 100, protein: 5, carbs: 10, fat: 2,
  createdAt: stamp, updatedAt: `2026-02-01T00:00:${String(n).padStart(2, '0')}.000Z`, ...extra,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(at(8, 15))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
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

async function openLogger(entries: DiaryEntry[], foods: Food[]): Promise<User> {
  m.getEntries.mockResolvedValue(entries)
  m.getFoods.mockResolvedValue(foods)
  const user = setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Log food'))
  await screen.findByRole('tablist', { name: 'Your foods' })
  return user
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const panel = () => screen.getByRole('tabpanel')
const quickNames = () => within(panel()).queryAllByRole('button', { name: /^Quick add / }).map((button) => button.getAttribute('aria-label'))

describe('Log food library tabs', () => {
  it('defaults to Recent and shows count badges only when above zero', async () => {
    await openLogger([entry(1, 'Rice')], [food('f1', 'Bar'), food('f2', 'Shake', { favorite: true })])
    expect(tab(/^Recent/).getAttribute('aria-selected')).toBe('true')
    expect(tab(/^Recent/).textContent).toBe('Recent1')
    expect(tab(/^Favorites/).textContent).toBe('Favorites1')
    expect(tab(/^My foods/).textContent).toBe('My foods2')
    expect(tab(/^Recipes/).textContent).toBe('Recipes')
    expect(quickNames()).toEqual(['Quick add Rice'])
  })

  it('lists all seven saved foods under My foods with no cap', async () => {
    const foods = Array.from({ length: 7 }, (_, i) => food(`f${i}`, `Food ${i}`))
    const user = await openLogger([], foods)
    await user.click(tab(/^My foods/))
    expect(quickNames()).toHaveLength(7)
    expect(tab(/^My foods/).textContent).toBe('My foods7')
  })

  it('lists only favorites on the Favorites tab, beyond five', async () => {
    const foods = [
      ...Array.from({ length: 6 }, (_, i) => food(`fav${i}`, `Fav ${i}`, { favorite: true })),
      food('n1', 'Plain'), food('n2', 'Explicit no', { favorite: false }),
    ]
    const user = await openLogger([], foods)
    await user.click(tab(/^Favorites/))
    const names = quickNames()
    expect(names).toHaveLength(6)
    expect(names).not.toContain('Quick add Plain')
    expect(names).not.toContain('Quick add Explicit no')
  })

  it('lists only recipes on Recipes and keeps them out of My foods', async () => {
    const user = await openLogger([], [food('f1', 'Bar'), recipe('r1', 'Stew')])
    await user.click(tab(/^Recipes/))
    expect(quickNames()).toEqual(['Quick add Stew'])
    await user.click(tab(/^My foods/))
    expect(quickNames()).toEqual(['Quick add Bar'])
  })

  it('does not list a planned entry under Recent', async () => {
    await openLogger([entry(2, 'Planned pasta', { planned: true }), entry(1, 'Eaten rice')], [])
    expect(quickNames()).toEqual(['Quick add Eaten rice'])
    expect(tab(/^Recent/).textContent).toBe('Recent1')
  })

  it('shows only eight of nine distinct recent entries, newest first', async () => {
    const entries = Array.from({ length: 9 }, (_, i) => entry(i + 1, `Dish ${i + 1}`))
    await openLogger(entries, [])
    const names = quickNames()
    expect(names).toHaveLength(8)
    expect(names[0]).toBe('Quick add Dish 9')
    expect(names).not.toContain('Quick add Dish 1')
    expect(tab(/^Recent/).textContent).toBe('Recent8')
  })

  it('collapses recent entries with the same name ignoring case', async () => {
    await openLogger([entry(3, 'Oatmeal'), entry(2, 'oatmeal'), entry(1, 'OATMEAL'), entry(0, 'Toast')], [])
    expect(quickNames()).toEqual(['Quick add Oatmeal', 'Quick add Toast'])
  })

  it('shows each tab empty line when nothing is stored', async () => {
    const user = await openLogger([], [])
    expect(within(panel()).getByText(/Your latest foods will appear here/)).toBeTruthy()
    await user.click(tab(/^Favorites/))
    expect(within(panel()).getByText(/No favorites yet/)).toBeTruthy()
    await user.click(tab(/^My foods/))
    expect(within(panel()).getByText(/No saved foods yet/)).toBeTruthy()
    await user.click(tab(/^Recipes/))
    expect(within(panel()).getByText(/No recipes yet/)).toBeTruthy()
    expect(quickNames()).toEqual([])
  })

  it('moves aria-selected and the panel label with each click', async () => {
    const user = await openLogger([], [])
    for (const label of ['Favorites', 'My foods', 'Recipes', 'Recent']) {
      await user.click(tab(new RegExp(`^${label}`)))
      const selected = screen.getAllByRole('tab').filter((item) => item.getAttribute('aria-selected') === 'true')
      expect(selected.map((item) => item.textContent)).toEqual([label])
      expect(panel().getAttribute('aria-labelledby')).toBe(selected[0].id)
    }
  })

  it('hides the tablist while a query is typed and restores it when cleared', async () => {
    const user = await openLogger([entry(1, 'Chicken breast')], [])
    const box = screen.getByPlaceholderText(/Search foods/)
    await user.type(box, 'chick')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('button', { name: 'Quick add Chicken breast' })).toBeTruthy()
    await user.clear(box)
    expect(screen.getByRole('tablist', { name: 'Your foods' })).toBeTruthy()
  })

  it('quick adds a favorite from the Favorites tab', async () => {
    const user = await openLogger([], [food('f9', 'Starred shake', { favorite: true, calories: 180 })])
    await user.click(tab(/^Favorites/))
    await user.click(screen.getByRole('button', { name: 'Quick add Starred shake' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ name: 'Starred shake', foodId: 'f9', calories: 180, date: todayISO() })
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('selects Recent again after closing and reopening the dialog', async () => {
    const user = await openLogger([entry(1, 'Rice')], [food('f1', 'Bar')])
    await user.click(tab(/^My foods/))
    expect(tab(/^My foods/).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(first('Log food'))
    await screen.findByRole('tablist', { name: 'Your foods' })
    expect(tab(/^Recent/).getAttribute('aria-selected')).toBe('true')
    expect(tab(/^My foods/).getAttribute('aria-selected')).toBe('false')
  })
})
