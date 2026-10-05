// Favorite foods: a toggle in the Foods view that pins a food first in the Foods list and the diary Saved foods panel.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Food } from './types'

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

const food = (name: string, over: Record<string, unknown> = {}): Food => ({
  id: `id-${name}`, name, serving: '1 serving', calories: 100, protein: 5, carbs: 10, fat: 2, createdAt: stamp, updatedAt: stamp, ...over,
}) as Food

let stored: Food[]

beforeEach(() => {
  stored = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockImplementation(async () => stored.map((item) => ({ ...item })))
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveFood.mockImplementation(async (next) => { stored = stored.map((item) => (item.id === next.id ? next : item)) })
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

const libraryNames = () => Array.from(document.querySelectorAll('.library-row .library-copy > strong')).map((node) => node.textContent)
const diaryNames = () => Array.from(document.querySelectorAll('.quick-food strong')).map((node) => node.textContent)
const savedFoodArg = () => {
  expect(m.saveFood).toHaveBeenCalledTimes(1)
  return m.saveFood.mock.calls[0][0] as Food & Record<string, unknown>
}

describe('favoriting a food', () => {
  it('shows an unpressed "Favorite <name>" button for a food that is not a favorite', async () => {
    stored = [food('Oats')]
    const user = await renderApp()
    await user.click(first('Foods'))
    const button = await screen.findByRole('button', { name: 'Favorite Oats' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('saves favorite: true with a new updatedAt and keeps every other field', async () => {
    stored = [food('Oats', { brand: 'Acme', fiber: 4 })]
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Favorite Oats' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const saved = savedFoodArg()
    expect(saved).toMatchObject({ id: 'id-Oats', name: 'Oats', favorite: true, brand: 'Acme', fiber: 4, createdAt: stamp })
    expect(saved.updatedAt).not.toBe(stamp)
  })

  it('flips the button to a pressed "Unfavorite <name>" once saved', async () => {
    stored = [food('Oats')]
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Favorite Oats' }))
    const button = await screen.findByRole('button', { name: 'Unfavorite Oats' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Favorite Oats' })).toBeNull()
  })

  it('removes the favorite key entirely on Unfavorite, keeping unknown fields', async () => {
    stored = [food('Oats', { favorite: true, brand: 'Acme' })]
    const user = await renderApp()
    await user.click(first('Foods'))
    const button = await screen.findByRole('button', { name: 'Unfavorite Oats' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await user.click(button)

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const saved = savedFoodArg()
    expect(saved).not.toHaveProperty('favorite')
    expect(saved).toMatchObject({ id: 'id-Oats', brand: 'Acme', createdAt: stamp })
    expect(saved.updatedAt).not.toBe(stamp)
  })

  it('toggles twice in a row back to a food with no favorite key', async () => {
    stored = [food('Oats')]
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Favorite Oats' }))
    await user.click(await screen.findByRole('button', { name: 'Unfavorite Oats' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(2))
    expect(m.saveFood.mock.calls[1][0]).not.toHaveProperty('favorite')
  })

  it('treats a stored favorite: false as not a favorite and writes true', async () => {
    stored = [food('Oats', { favorite: false })]
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Favorite Oats' }))
    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    expect(savedFoodArg().favorite).toBe(true)
  })

  it('shows an error and keeps the food unchanged on screen when the save fails', async () => {
    stored = [food('Oats')]
    m.saveFood.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Favorite Oats' }))
    await waitFor(() => expect(document.querySelector('.toast.error')?.textContent).toContain('That food could not be updated'))
    expect(screen.getByRole('button', { name: 'Favorite Oats' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('favorites sort first', () => {
  it('lists favorites before the rest in the Foods view, each group alphabetical', async () => {
    stored = [food('Apple'), food('Zucchini', { favorite: true }), food('Banana'), food('Mango', { favorite: true })]
    const user = await renderApp()
    await user.click(first('Foods'))
    await screen.findByRole('button', { name: 'Edit Apple' })
    expect(libraryNames()).toEqual(['Mango', 'Zucchini', 'Apple', 'Banana'])
  })

  it('lists favorites first in the diary Saved foods panel', async () => {
    stored = [food('Apple'), food('Banana'), food('Zucchini', { favorite: true })]
    await renderApp()
    await waitFor(() => expect(diaryNames()).toEqual(['Zucchini', 'Apple', 'Banana']))
  })

  it('keeps a favorite inside the five shown in the diary panel even when it sorts last by name', async () => {
    stored = [food('A1'), food('A2'), food('A3'), food('A4'), food('A5'), food('A6'), food('Zed', { favorite: true })]
    await renderApp()
    await waitFor(() => expect(diaryNames()).toEqual(['Zed', 'A1', 'A2', 'A3', 'A4']))
    const panel = document.querySelector('.quick-panel') as HTMLElement
    expect(within(panel).getByText(/Showing five saved foods/)).toBeTruthy()
  })

  it('moves a food to the top of the list right after it is favorited', async () => {
    stored = [food('Apple'), food('Banana')]
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Favorite Banana' }))
    await waitFor(() => expect(libraryNames()).toEqual(['Banana', 'Apple']))
  })

  it('sorts alphabetically when nothing is a favorite', async () => {
    stored = [food('Banana'), food('Apple')]
    const user = await renderApp()
    await user.click(first('Foods'))
    await screen.findByRole('button', { name: 'Edit Apple' })
    expect(libraryNames()).toEqual(['Apple', 'Banana'])
  })
})
