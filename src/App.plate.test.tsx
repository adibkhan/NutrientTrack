// Plate logging on the Log food search screen: "+" on any result row, the tray, one atomic save, Undo, discard prompt and smart history.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings } from './types'
import { shiftDate, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteEntries: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
// These tests walk several screens with user-event; give them room on a busy CI machine.
vi.setConfig({ testTimeout: 20000 })
const stamp = '2026-01-01T00:00:00.000Z'
let today = ''
const settings = (): Settings => ({ id: 'profile', goals: { weightUnit: 'lb', calories: 2000 }, preferences: { welcomed: true }, updatedAt: stamp } as Settings)
const at = (hour: number, minute: number) => new Date(2026, 5, 10, hour, minute, 0) // local time

const catalog = [
  { id: 'usda-sr-173944', fdcId: 1, name: 'Bananas, raw', category: 'Fruits and Fruit Juices', source: 'USDA SR Legacy', per100g: { calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 }, portions: [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118]] },
  { id: 'usda-sr-171287', fdcId: 2, name: 'Egg, whole, raw, fresh', category: 'Dairy and Egg Products', source: 'USDA SR Legacy', per100g: { calories: 143, protein: 12.56, carbs: 0.72, fat: 9.51 }, portions: [['1 large', 50]] },
  { id: 'usda-sr-9', fdcId: 3, name: 'Chicken, broiler, breast, cooked', category: 'Poultry Products', source: 'USDA SR Legacy', per100g: { calories: 165, protein: 31, carbs: 0, fat: 3.6 } },
]
const bar: Food = { id: 'f1', name: 'Protein bar', serving: '1 bar', calories: 210, protein: 20, carbs: 22, fat: 7, createdAt: stamp, updatedAt: stamp }
const huge: Food = { id: 'f2', name: 'Feast', serving: '1 platter', calories: 6000, protein: 20, carbs: 22, fat: 7, createdAt: stamp, updatedAt: stamp }
const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: shiftDate(today, -1), meal: 'dinner', time: '19:00', calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})
const makePorridge = () => entry({ id: 'e1', name: 'Porridge', calories: 300, protein: 10, carbs: 40, fat: 5 })

let entries: DiaryEntry[]
let foods: Food[]

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(at(12, 15))
  today = todayISO()
  entries = [makePorridge()]
  foods = [bar]
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockImplementation(async () => foods)
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(settings())
  m.saveSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
  m.deleteEntries.mockImplementation(async (ids) => { entries = entries.filter((item) => !ids.includes(item.id)) })
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

type User = ReturnType<typeof userEvent.setup>
const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
async function openLogger(): Promise<User> {
  const user = setup()
  render(<App />)
  await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
  await screen.findByRole('dialog')
  return user
}
const dialog = () => screen.getByRole('dialog')
const search = () => within(dialog()).getByRole('textbox', { name: 'Search foods' })
const tray = () => screen.queryByRole('region', { name: 'Plate' })
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const plus = (name: string) => within(dialog()).getByRole('button', { name: new RegExp(`^Add ${esc(name)} to plate(, \\d+ on plate)?$`) })
/** The saved bar lives on the My foods tab, so open it first when its row is not showing. */
async function barPlus2(user: User) {
  if (!within(dialog()).queryByRole('button', { name: /^Add Feast to plate/ })) await user.click(await screen.findByRole('tab', { name: /My foods/ }))
  return plus('Feast')
}
async function barPlus(user: User) {
  if (!within(dialog()).queryByRole('button', { name: /^Add Protein bar to plate/ })) await user.click(await screen.findByRole('tab', { name: /My foods/ }))
  return plus('Protein bar')
}
const summary = () => within(tray() as HTMLElement).getByRole('button', { expanded: false }) as HTMLElement
const recentTab = (user: User) => user.click(screen.getByRole('tab', { name: /^Recent/ }))
const toast = () => document.querySelector('.toast') as HTMLElement | null
const compact = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
async function typeQuery(user: User, text: string) {
  await user.clear(search())
  await user.type(search(), text)
}
/** Banana from the catalog, an egg from the catalog, and the saved bar: three foods over two searches. */
async function fillPlate(user: User) {
  await user.click(await barPlus(user))
  await typeQuery(user, 'banana')
  await user.click(await within(dialog()).findByRole('button', { name: 'Add Bananas, raw to plate' }))
  await typeQuery(user, 'egg')
  await user.click(await within(dialog()).findByRole('button', { name: 'Add Egg, whole, raw, fresh to plate' }))
}

describe('add to plate', () => {
  it('gives every row type a round add button and keeps the row body for the detail form', async () => {
    const user = await openLogger()
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    expect(plus('Protein bar')).toBeTruthy()
    await user.click(await screen.findByRole('tab', { name: /^Recent/ }))
    expect(plus('Porridge')).toBeTruthy()
    await typeQuery(user, 'banana')
    expect(await within(dialog()).findByRole('button', { name: 'Add Bananas, raw to plate' })).toBeTruthy()
    // The row body still opens the detail form, and the plate stays empty.
    await user.click(await within(dialog()).findByRole('button', { name: /^Bananas, raw/ }))
    expect(await screen.findByRole('button', { name: /Back to food search/ })).toBeTruthy()
    expect((screen.getByLabelText('Food or meal name') as HTMLInputElement).value).toBe('Bananas, raw')
    expect(tray()).toBeNull()
  })

  it('opens the detail form from a recent row without touching the plate', async () => {
    const user = await openLogger()
    await user.click(within(dialog()).getByRole('button', { name: /^Porridge/ }))
    expect((await screen.findByLabelText('Food or meal name') as HTMLInputElement).value).toBe('Porridge')
    expect(m.saveEntries).not.toHaveBeenCalled()
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('adds recents and saved foods at their stored amount and catalog foods at the default portion', async () => {
    const user = await openLogger()
    expect(tray()).toBeNull()
    await user.click(plus('Porridge'))
    expect(compact(tray())).toContain('1 food · 300 kcal')
    await user.click(await barPlus(user))
    expect(compact(tray())).toContain('2 foods · 510 kcal')
    await typeQuery(user, 'banana')
    await user.click(await within(dialog()).findByRole('button', { name: 'Add Bananas, raw to plate' }))
    // 1 medium banana = 118 g = 105 kcal.
    expect(compact(tray())).toContain('3 foods · 615 kcal')
    // The search box keeps its text and the plate survives a new query.
    expect((search() as HTMLInputElement).value).toBe('banana')
    await typeQuery(user, 'egg')
    expect(compact(tray())).toContain('3 foods')
  })

  it('falls back to 100 g when a catalog food has no household portion', async () => {
    const user = await openLogger()
    await typeQuery(user, 'chicken')
    await user.click(await within(dialog()).findByRole('button', { name: 'Add Chicken, broiler, breast, cooked to plate' }))
    expect(compact(tray())).toContain('1 food · 165 kcal')
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 1 food' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const [only] = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(only.grams).toBe(100)
    expect(only.catalogId).toBe('usda-sr-9')
  })

  it('shows the count on the button and adds another serving on a second tap', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.click(await barPlus(user))
    expect(compact(tray())).toContain('1 food · 420 kcal')
    expect(plus('Protein bar').textContent).toBe('2')
    await user.click(summary())
    const list = within(tray() as HTMLElement).getByRole('list', { name: 'Foods on your plate' })
    expect(compact(list)).toContain('×2')
  })

  it('lowers a serving and removes a food from the expanded tray', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.click(await barPlus(user))
    await recentTab(user)
    await user.click(plus('Porridge'))
    await user.click(summary())
    const t = tray() as HTMLElement
    expect(compact(t)).toContain('Protein 50 g · Carbs 84 g · Fat 19 g')
    await user.click(within(t).getByRole('button', { name: 'Fewer Protein bar' }))
    expect(compact(t)).toContain('2 foods · 510 kcal')
    await user.click(within(t).getByRole('button', { name: 'Remove Protein bar from plate' }))
    expect(compact(t)).toContain('1 food · 300 kcal')
    await user.click(within(t).getByRole('button', { name: 'Remove Porridge from plate' }))
    expect(tray()).toBeNull()
    expect(plus('Porridge').textContent).toBe('')
  })

  it('announces the plate in a live region and names its controls', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    const t = tray() as HTMLElement
    expect(within(dialog()).getByRole('status').textContent).toBe('1 food on your plate, 210 kilocalories, logging to Lunch')
    expect(within(t).getByRole('combobox', { name: 'Log to meal' })).toBeTruthy()
    expect(within(t).getByRole('button', { name: 'Log 1 food' })).toBeTruthy()
  })
})

describe('log the plate', () => {
  it('saves everything in one saveEntries call, in the order tapped, in the clock meal', async () => {
    const user = await openLogger()
    await fillPlate(user)
    expect(compact(tray())).toContain('3 foods · 387 kcal')
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 3 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(m.saveEntry).not.toHaveBeenCalled()
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.map((item) => item.name)).toEqual(['Protein bar', 'Bananas, raw', 'Egg, whole, raw, fresh'])
    expect(saved.every((item) => item.meal === 'lunch' && item.date === today && item.time === '12:15' && !item.planned)).toBe(true)
    const created = saved.map((item) => Date.parse(item.createdAt))
    expect(created[1] - created[0]).toBe(1)
    expect(created[2] - created[1]).toBe(1)
    expect(saved[0]).toMatchObject({ foodId: 'f1', calories: 210, protein: 20 })
    expect(saved[1]).toMatchObject({ catalogId: 'usda-sr-173944', grams: 118, calories: 105 })
    expect(saved[2]).toMatchObject({ catalogId: 'usda-sr-171287', grams: 50, calories: 71.5 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toast()?.textContent).toContain('Added 3 foods to Lunch.')
  })

  it('stores a doubled saved food as two servings and a doubled catalog food as double the grams', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.click(await barPlus(user))
    await typeQuery(user, 'banana')
    const banana = await within(dialog()).findByRole('button', { name: 'Add Bananas, raw to plate' })
    await user.click(banana)
    await user.click(banana)
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 2 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved[0]).toMatchObject({ servings: 2, calories: 420, protein: 40 })
    expect(saved[1]).toMatchObject({ grams: 236, calories: 210 })
    expect(saved[1].servings).toBeUndefined()
  })

  it('logs to the meal chosen on the tray', async () => {
    const user = await openLogger()
    await fillPlate(user)
    await user.selectOptions(within(tray() as HTMLElement).getByRole('combobox', { name: 'Log to meal' }), 'dinner')
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 3 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect((m.saveEntries.mock.calls[0][0] as DiaryEntry[]).map((item) => item.meal)).toEqual(['dinner', 'dinner', 'dinner'])
    await waitFor(() => expect(toast()?.textContent).toContain('Added 3 foods to Dinner.'))
  })

  it('logs to the day being viewed, with no time, and marks a future day as planned', async () => {
    const user = setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    await screen.findByRole('dialog')
    await user.click(await barPlus(user))
    await recentTab(user)
    await user.click(plus('Porridge'))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 2 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.every((item) => item.date === shiftDate(today, 1) && item.planned === true && item.time === undefined)).toBe(true)
    await waitFor(() => expect(toast()?.textContent).toMatch(/Added 2 foods to Lunch on .*2 later meals added as planned\./))
  })

  it('logs to a past day as eaten food', async () => {
    const user = setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    await screen.findByRole('dialog')
    await user.click(await barPlus(user))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 1 food' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const [saved] = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved).toMatchObject({ date: shiftDate(today, -1) })
    expect(saved.planned).toBeUndefined()
    expect(saved.time).toBeUndefined()
  })

  it('refuses a plate over the entry caps and keeps it', async () => {
    foods = [huge]
    const user = await openLogger()
    await user.click(await barPlus2(user))
    await user.click(await barPlus2(user))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 1 food' }))
    expect((await within(tray() as HTMLElement).findByRole('alert')).textContent).toMatch(/Feast: That's more than 10000 kcal/)
    expect(m.saveEntries).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(summary())
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Fewer Feast' }))
    expect(within(tray() as HTMLElement).queryByRole('alert')).toBeNull()
  })

  it('keeps the plate when the save fails', async () => {
    m.saveEntries.mockRejectedValueOnce(new Error('disk full'))
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 1 food' }))
    await waitFor(() => expect(toast()?.textContent).toMatch(/could not be added/i))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(compact(tray())).toContain('1 food')
  })

  it('Undo removes exactly the plate foods, once', async () => {
    entries = [entry({ id: 'old', name: 'Existing', date: today })]
    const user = await openLogger()
    await fillPlate(user)
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 3 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    await waitFor(() => expect(toast()?.textContent).toContain('Added 3 foods to Lunch.'))
    const undo = within(toast() as HTMLElement).getByRole('button', { name: 'Undo' })
    fireEvent.click(undo)
    fireEvent.click(undo)
    await waitFor(() => expect(toast()?.textContent).toContain('Removed 3 foods.'))
    expect(m.deleteEntries).toHaveBeenCalledTimes(1)
    expect(m.deleteEntries.mock.calls[0][0]).toEqual(saved.map((item) => item.id))
    expect(entries.map((item) => item.id)).toEqual(['old'])
  })
})

describe('closing with a plate', () => {
  it('closes at once when the plate is empty', async () => {
    const user = await openLogger()
    await user.click(within(dialog()).getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks inline before discarding, never with window.confirm', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const user = await openLogger()
    await fillPlate(user)
    await user.click(within(dialog()).getByRole('button', { name: 'Close dialog' }))
    const t = tray() as HTMLElement
    expect(within(t).getByText('Discard 3 foods?')).toBeTruthy()
    expect(document.activeElement).toBe(within(t).getByRole('button', { name: 'Keep plate' }))
    await user.click(within(t).getByRole('button', { name: 'Keep plate' }))
    expect(within(tray() as HTMLElement).queryByText('Discard 3 foods?')).toBeNull()
    expect(compact(tray())).toContain('3 foods')
    expect(document.activeElement).toBe(search())
    await user.click(within(dialog()).getByRole('button', { name: 'Close dialog' }))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.saveEntries).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('Escape asks first, a second Escape keeps the plate, and a third asks again', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.keyboard('{Escape}')
    expect(within(tray() as HTMLElement).getByText('Discard 1 food?')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(within(tray() as HTMLElement).queryByText('Discard 1 food?')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(within(tray() as HTMLElement).getByText('Discard 1 food?')).toBeTruthy()
  })

  it('keeps the plate when going into a detail form and back', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await recentTab(user)
    await user.click(within(dialog()).getByRole('button', { name: /^Porridge/ }))
    expect(await screen.findByRole('button', { name: 'Add to plate' })).toBeTruthy()
    expect(screen.queryByText(/still on your plate/)).toBeNull()
    await user.click(screen.getByRole('button', { name: /Back to food search/ }))
    expect(compact(tray())).toContain('1 food · 210 kcal')
  })

  it.each([
    ['the close button', async (user: User) => { await user.click(within(dialog()).getByRole('button', { name: 'Close dialog' })) }],
    ['Cancel', async (user: User) => { await user.click(within(dialog()).getByRole('button', { name: 'Cancel' })) }],
    ['Escape', async (user: User) => { await user.keyboard('{Escape}') }],
  ])('asks before discarding when %s is used on a detail form', async (_name, close) => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await recentTab(user)
    await user.click(within(dialog()).getByRole('button', { name: /^Porridge/ }))
    await screen.findByRole('button', { name: 'Add to plate' })
    await close(user)
    expect(await within(dialog()).findByText('Discard 1 food?')).toBeTruthy()
    expect(m.saveEntries).not.toHaveBeenCalled()
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Keep plate' }))
    expect(compact(tray())).toContain('1 food · 210 kcal')
  })

  it('asks before discarding from the manual form too', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.click(within(dialog()).getByRole('button', { name: 'Manual quick add' }))
    await user.click(within(dialog()).getByRole('button', { name: 'Close dialog' }))
    expect(await within(dialog()).findByText('Discard 1 food?')).toBeTruthy()
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('foods finished in other forms join the plate', () => {
  it('adds a catalog food from its detail form to the plate and returns to search', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await typeQuery(user, 'banana')
    await user.click(await within(dialog()).findByRole('button', { name: /^Bananas, raw/ }))
    expect(screen.queryByRole('radiogroup', { name: 'Destination meal' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Add to plate' }))
    expect(m.saveEntry).not.toHaveBeenCalled()
    expect(compact(tray())).toContain('2 foods · 315 kcal')
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Log 2 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.map((item) => item.name)).toEqual(['Protein bar', 'Bananas, raw'])
    expect(saved[1]).toMatchObject({ grams: 118, calories: 105, catalogId: 'usda-sr-173944', meal: 'lunch' })
  })

  it('adds a manual food to the plate instead of saving it alone', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await user.click(within(dialog()).getByRole('button', { name: 'Manual quick add' }))
    await user.type(screen.getByLabelText('Food or meal name'), 'Toast')
    await user.type(screen.getByLabelText(/^Calories/), '120')
    await user.click(screen.getByRole('button', { name: 'Add to plate' }))
    expect(m.saveEntry).not.toHaveBeenCalled()
    expect(compact(tray())).toContain('2 foods · 330 kcal')
  })

  it('adds described foods to the plate and keeps the plate', async () => {
    const user = await openLogger()
    await user.click(await barPlus(user))
    await typeQuery(user, '2 eggs')
    const card = await within(dialog()).findByRole('region', { name: 'Log as a meal' })
    await user.click(within(card).getByRole('button', { name: /^Add 1 food to plate/ }))
    expect(m.saveEntries).not.toHaveBeenCalled()
    expect(compact(tray())).toContain('2 foods')
    expect((search() as HTMLInputElement).value).toBe('')
  })
})

describe('history first in search', () => {
  it('lists recents that match every typed word above the catalog, with a plus on each', async () => {
    entries = [entry({ id: 'c1', name: 'Chicken breast, grilled', calories: 250 }), entry({ id: 'c2', name: 'Breast of chicken wrap', calories: 410 }), entry({ id: 'c3', name: 'Rice' })]
    const user = await openLogger()
    await typeQuery(user, 'chick br')
    const body = (await within(dialog()).findByText('USDA catalog')).closest('.logger-result-group') as HTMLElement
    const recents = within(dialog()).getByText('Recent entries').closest('.logger-result-group') as HTMLElement
    expect(Array.from(recents.querySelectorAll('.result-copy strong')).map((node) => node.textContent)).toEqual(['Chicken breast, grilled', 'Breast of chicken wrap'])
    expect(recents.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(recents).getAllByRole('button', { name: /^Add .* to plate$/ })).toHaveLength(2)
    expect(within(dialog()).queryByRole('button', { name: 'Add Rice to plate' })).toBeNull()
  })
})

describe('usual for this time of day', () => {
  const week = (name: string, calories: number, time: string, meal: DiaryEntry['meal'], days: number[]) => days.map((back) => entry({ id: `${name}-${back}`, name, calories, time, meal, date: shiftDate(today, -back), updatedAt: `2026-06-0${Math.min(9, back)}T00:00:00.000Z` }))

  it('puts the usual foods for the hour first, and leaves them out of Recent', async () => {
    vi.setSystemTime(at(8, 10))
    entries = [
      ...week('Oatmeal', 150, '08:00', 'breakfast', [1, 2, 3, 4]),
      ...week('Coffee', 5, '08:20', 'breakfast', [1, 2]),
      ...week('Pasta', 600, '19:00', 'dinner', [1, 2, 3]),
    ]
    await openLogger()
    const panel = screen.getByRole('tabpanel')
    const usual = within(panel).getByText('Usual for Breakfast').closest('.logger-result-group') as HTMLElement
    expect(Array.from(usual.querySelectorAll('.result-copy strong')).map((node) => node.textContent)).toEqual(['Oatmeal', 'Coffee'])
    const titles = Array.from(panel.querySelectorAll('.logger-section-title span')).map((node) => node.textContent)
    expect(titles).toEqual(['Usual for Breakfast', 'Recent'])
    const recent = within(panel).getByText('Recent', { selector: '.logger-section-title span' }).closest('.logger-result-group') as HTMLElement
    expect(Array.from(recent.querySelectorAll('.result-copy strong')).map((node) => node.textContent)).toEqual(['Pasta'])
    // The usual rows add to the plate like any other.
    await act(async () => { fireEvent.click(within(usual).getByRole('button', { name: 'Add Oatmeal to plate' })) })
    expect(compact(tray())).toContain('1 food · 150 kcal')
  })

  it('shows dinner foods at dinner time', async () => {
    vi.setSystemTime(at(19, 10))
    entries = [...week('Oatmeal', 150, '08:00', 'breakfast', [1, 2, 3, 4]), ...week('Pasta', 600, '19:00', 'dinner', [1, 2, 3])]
    await openLogger()
    expect(within(screen.getByRole('tabpanel')).getByText('Usual for Dinner')).toBeTruthy()
  })

  it('hides the group with fewer than 5 past entries', async () => {
    vi.setSystemTime(at(8, 10))
    entries = week('Oatmeal', 150, '08:00', 'breakfast', [1, 2, 3, 4])
    await openLogger()
    expect(within(screen.getByRole('tabpanel')).queryByText(/^Usual for/)).toBeNull()
    expect(within(screen.getByRole('tabpanel')).getByText('Oatmeal')).toBeTruthy()
  })

  it('collapses past five rows behind Show more', async () => {
    vi.setSystemTime(at(8, 10))
    entries = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].flatMap((name, i) => week(`Food ${name}`, 100 + i, '08:00', 'breakfast', [1 + i]))
    const user = await openLogger()
    const panel = screen.getByRole('tabpanel')
    const usual = within(panel).getByText('Usual for Breakfast').closest('.logger-result-group') as HTMLElement
    expect(usual.querySelectorAll('.quick-result')).toHaveLength(5)
    await user.click(within(usual).getByRole('button', { name: 'Show 2 more' }))
    expect(usual.querySelectorAll('.quick-result')).toHaveLength(7)
  })
})

describe('quick add and the plate', () => {
  it('shows Log now only while the plate is empty, 8px+ away from the plus', async () => {
    const user = await openLogger()
    expect(within(dialog()).getByRole('button', { name: 'Log Porridge now' })).toBeTruthy()
    await user.click(plus('Porridge'))
    expect(within(dialog()).queryByRole('button', { name: /^Log .* now$/ })).toBeNull()
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: /^1 food/ }))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: 'Remove Porridge from plate' }))
    expect(within(dialog()).getByRole('button', { name: 'Log Porridge now' })).toBeTruthy()
  })
})

describe('one food, one line', () => {
  it('merges a recent that carries a catalog id with the catalog row, and shows the state on both', async () => {
    entries = [entry({ id: 'bn', name: 'Bananas, raw', calories: 105, grams: 118, catalogId: 'usda-sr-173944', catalogSource: 'USDA SR Legacy' })]
    const user = await openLogger()
    await user.click(plus('Bananas, raw'))
    await typeQuery(user, 'banana')
    await waitFor(() => expect(within(dialog()).getAllByRole('button', { name: /^Add Bananas, raw to plate, 1 on plate$/ })).toHaveLength(2))
    await user.click(within(dialog()).getAllByRole('button', { name: /^Add Bananas, raw to plate/ })[1])
    expect(compact(tray())).toContain('1 food · 210 kcal')
    expect(within(dialog()).getAllByRole('button', { name: /^Add Bananas, raw to plate, 2 on plate$/ }).length).toBeGreaterThan(1)
  })

  it('keeps different amounts of the same catalog food on separate lines', async () => {
    const user = await openLogger()
    await typeQuery(user, 'banana')
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Bananas, raw to plate/ }))
    await user.click(await within(dialog()).findByRole('button', { name: /^Bananas, raw/ }))
    const grams = await screen.findByLabelText(/Amount/)
    await user.clear(grams)
    await user.type(grams, '200')
    await user.click(screen.getByRole('button', { name: 'Add to plate' }))
    expect(compact(tray())).toContain('2 foods')
  })
})

describe('Usual for follows the meal being logged', () => {
  const dinnerAndBreakfast = () => {
    const mk = (name: string, meal: DiaryEntry['meal'], time: string, back: number) => entry({ id: `${name}-${back}`, name, meal, time, date: shiftDate(today, -back), updatedAt: `2026-06-0${back}T00:00:00.000Z` })
    return [1, 2, 3].map((b) => mk('Oatmeal', 'breakfast', '08:00', b)).concat([1, 2, 3].map((b) => mk('Pasta', 'dinner', '19:00', b)))
  }

  it('uses the meal from Add to Dinner, not the clock', async () => {
    vi.setSystemTime(at(8, 10))
    entries = dinnerAndBreakfast()
    const user = setup()
    render(<App />)
    const dinner = await screen.findByRole('region', { name: 'Dinner' })
    await user.click(within(dinner).getByRole('button', { name: /^Add to / }))
    await screen.findByRole('dialog')
    const panel = screen.getByRole('tabpanel')
    const group = within(panel).getByText('Usual for Dinner').closest('.logger-result-group') as HTMLElement
    expect(Array.from(group.querySelectorAll('.result-copy strong')).map((node) => node.textContent)).toEqual(['Pasta'])
  })

  it('follows the tray meal once it is changed', async () => {
    vi.setSystemTime(at(8, 10))
    entries = dinnerAndBreakfast()
    const user = await openLogger()
    expect(within(screen.getByRole('tabpanel')).getByText('Usual for Breakfast')).toBeTruthy()
    await user.click(within(dialog()).getByRole('button', { name: 'Log Oatmeal now' }).closest('.quick-result')!.querySelector('.plate-add') as HTMLElement)
    await user.selectOptions(within(tray() as HTMLElement).getByRole('combobox', { name: 'Log to meal' }), 'dinner')
    expect(within(screen.getByRole('tabpanel')).getByText('Usual for Dinner')).toBeTruthy()
  })

  it('ranks by the meal, not the wall clock, on a day that is not today', async () => {
    vi.setSystemTime(at(8, 10))
    entries = dinnerAndBreakfast()
    const user = setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    await screen.findByRole('dialog')
    const label = within(screen.getByRole('tabpanel')).getByText(/^Usual for/)
    expect(label.textContent).toBe('Usual for Breakfast')
    const group = label.closest('.logger-result-group') as HTMLElement
    expect(Array.from(group.querySelectorAll('.result-copy strong')).map((node) => node.textContent)).toEqual(['Oatmeal'])
  })

  it('puts the calories in the button names of same-named usual rows', async () => {
    vi.setSystemTime(at(8, 10))
    const mk = (id: string, calories: number, back: number) => entry({ id, name: 'Latte', calories, meal: 'breakfast', time: '08:00', date: shiftDate(today, -back) })
    entries = [mk('l1', 120, 1), mk('l2', 120, 2), mk('l3', 180, 3), mk('l4', 180, 4), mk('l5', 180, 5)]
    await openLogger()
    expect(within(dialog()).getByRole('button', { name: 'Add Latte, 120 kcal to plate' })).toBeTruthy()
    expect(within(dialog()).getByRole('button', { name: 'Add Latte, 180 kcal to plate' })).toBeTruthy()
  })
})

describe('plate accessibility and limits', () => {
  it('keeps a polite status region mounted with an empty plate and fills it when a food is added', async () => {
    const user = await openLogger()
    const status = within(dialog()).getByRole('status')
    expect(status.textContent).toBe('')
    await user.click(plus('Porridge'))
    expect(within(dialog()).getByRole('status')).toBe(status)
    expect(status.textContent).toMatch(/^1 food on your plate/)
  })

  it('puts the tray before the results in tab order', async () => {
    const user = await openLogger()
    await user.click(plus('Porridge'))
    const t = tray() as HTMLElement
    const firstRow = dialog().querySelector('.quick-result') as HTMLElement
    expect(t.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reads the count of a line as plain hidden text, not an aria-label on a span', async () => {
    const user = await openLogger()
    await user.click(plus('Porridge'))
    await user.click(plus('Porridge'))
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: /^1 food/ }))
    const stepper = within(tray() as HTMLElement).getByRole('group', { name: 'Servings of Porridge' })
    expect(stepper.querySelector('span[aria-label]')).toBeNull()
    expect(stepper.querySelector('.visually-hidden')?.textContent).toBe('2 on plate')
  })

  it('says 20 is the most per food and disables more at the limit', async () => {
    const user = await openLogger()
    for (let i = 0; i < 21; i += 1) await user.click(plus('Porridge'))
    expect(compact(tray())).toContain('1 food · 6,000 kcal')
    expect((await within(tray() as HTMLElement).findByRole('alert')).textContent).toContain('20 is the most per food here')
    await user.click(within(tray() as HTMLElement).getByRole('button', { name: /^1 food/ }))
    expect(within(tray() as HTMLElement).getByText('20 is the most per food here')).toBeTruthy()
    expect(within(tray() as HTMLElement).getByRole('button', { name: 'More Porridge' })).toHaveProperty('disabled', true)
  })
})

describe('double taps', () => {
  it('saves a plate once when Log is tapped twice before the first save finishes', async () => {
    let release: () => void = () => undefined
    m.saveEntries.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const user = await openLogger()
    await user.click(plus('Porridge'))
    const log = within(tray() as HTMLElement).getByRole('button', { name: 'Log 1 food' })
    fireEvent.click(log)
    fireEvent.click(log)
    // The save starts after the (non-blocking) nutrient lookup, so wait for it; the second tap must not have started another.
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    fireEvent.click(log)
    expect(m.saveEntries).toHaveBeenCalledTimes(1)
    release()
  })
})
