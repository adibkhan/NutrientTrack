// Power-user friction: Foods search and sort, logger saved-food matching, long weight history, MyFitnessPal re-import.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings, WeightEntry } from './types'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(), saveEntriesAndWeights: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const settings = { id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp } as Settings
const food = (id: string, name: string, extra: Partial<Food> = {}): Food => ({ id, name, serving: '1 serving', calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp, ...extra })
const names = ['Apple pie', 'Banana bread', 'Chicken breast grilled', 'Chicken soup', 'Chicken wings', 'Chicken salad', 'Chicken curry', 'Chicken nuggets', 'Crème fraîche', 'Date loaf']
const manyFoods = names.map((name, index) => food(`f${index}`, name))

let entries: DiaryEntry[]
beforeEach(() => {
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue(manyFoods)
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(settings)
  m.saveEntriesAndWeights.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks() })

const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const rowNames = () => Array.from(document.querySelectorAll('.library-row .library-copy strong')).map((node) => node.textContent)

describe('Foods tab search and sort', () => {
  it('hides the controls under 8 foods', async () => {
    m.getFoods.mockResolvedValue(manyFoods.slice(0, 7))
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Foods' }))[0])
    await screen.findByText('Apple pie')
    expect(screen.queryByRole('searchbox', { name: 'Search saved foods' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Sort saved foods' })).toBeNull()
  })

  it('filters by diacritic-insensitive tokens and sorts A to Z or by use', async () => {
    entries = [
      { id: 'u1', foodId: 'f9', date: '2026-06-01', meal: 'lunch', name: 'Date loaf', calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp },
      { id: 'u2', foodId: 'f9', date: '2026-06-02', meal: 'lunch', name: 'Date loaf', calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp },
    ]
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Foods' }))[0])
    const search = await screen.findByRole('searchbox', { name: 'Search saved foods' })
    expect(rowNames()[0]).toBe('Date loaf')
    await user.type(search, 'FRAICHE creme')
    expect(rowNames()).toEqual(['Crème fraîche'])
    await user.clear(search)
    await user.type(search, 'chicken')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort saved foods' }), 'az')
    expect(rowNames()).toEqual(['Chicken breast grilled', 'Chicken curry', 'Chicken nuggets', 'Chicken salad', 'Chicken soup', 'Chicken wings'])
    await user.clear(search)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort saved foods' }), 'used')
    expect(rowNames()[0]).toBe('Date loaf')
    await user.type(search, 'zzz')
    expect(await screen.findByText(/No saved foods match/)).toBeTruthy()
  })
})

describe('logger saved-food results', () => {
  it('matches tokens in any order and expands past five', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Log food'))
    const box = await screen.findByPlaceholderText(/Search foods/)
    await user.type(box, 'grilled chick')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Chicken breast grilled')).toBeTruthy()
    expect(within(dialog).queryByText('Chicken soup')).toBeNull()
    await user.clear(box)
    await user.type(box, 'chicken')
    expect(within(dialog).getAllByRole('button', { name: /^Log Chicken.* now$/ })).toHaveLength(5)
    await user.click(within(dialog).getByRole('button', { name: 'Show 1 more' }))
    expect(within(dialog).getAllByRole('button', { name: /^Log Chicken.* now$/ })).toHaveLength(6)
    expect(within(dialog).queryByRole('button', { name: /Show \d+ more/ })).toBeNull()
  })
})

describe('weight chart on a long history', () => {
  it('shows y labels, years on the axis and at most 120 plotted points', async () => {
    const weights: WeightEntry[] = Array.from({ length: 500 }, (_, index) => {
      const d = new Date(2025, 0, 1 + index, 12)
      return { id: `w${index}`, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, weight: 200 - index * 0.04, unit: 'lb', createdAt: stamp, updatedAt: stamp }
    })
    m.getWeights.mockResolvedValue(weights)
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Trends' }))[0])
    await user.click(await screen.findByRole('button', { name: 'All' }))
    await waitFor(() => expect(document.querySelectorAll('.chart-axis-label')).toHaveLength(3))
    expect(document.querySelectorAll('.chart-point').length).toBeLessThanOrEqual(120)
    expect(document.querySelectorAll('.chart-point').length).toBeGreaterThan(20)
    expect(document.querySelector('.chart-labels')?.textContent).toMatch(/Jan.*2025/)
  })
})

describe('MyFitnessPal re-import', () => {
  const MFP = `Date,Meal,Calories,Fat (g),Carbohydrates (g),Protein (g)
2026-01-05,Breakfast,550,15,60,45
2026-01-05,Dinner,900,30,90,60
`
  it('skips rows already in the diary and says so', async () => {
    entries = [{ id: 'mine', date: '2026-01-05', meal: 'breakfast', name: 'MyFitnessPal breakfast', calories: 550, protein: 45, carbs: 60, fat: 15, createdAt: stamp, updatedAt: stamp }]
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Settings' }))[0])
    const panel = await screen.findByRole('region', { name: 'Import from another app' })
    await user.upload(within(panel).getByLabelText('Choose CSV or Excel files'), new File([MFP], 'Nutrition-Summary.csv', { type: 'text/csv' }))
    await user.click(await within(panel).findByRole('button', { name: 'Import 1 item' }))
    await waitFor(() => expect(m.saveEntriesAndWeights).toHaveBeenCalledTimes(1))
    expect((m.saveEntriesAndWeights.mock.calls[0][0] as DiaryEntry[]).map((e) => e.meal)).toEqual(['dinner'])
    expect(await within(panel).findByText(/Skipped 1 item already in your diary\./)).toBeTruthy()
  })
})
