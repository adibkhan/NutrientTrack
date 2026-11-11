// Row tap to edit, default portions, Undo for bulk adds, planned copies and diary order.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'
import { shiftDate, sumEntries, todayISO } from './lib/utils'

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
const stamp = '2026-01-01T00:00:00.000Z'
const today = todayISO()
const yesterday = shiftDate(today, -1)
const settings = (): Settings => ({ id: 'profile', goals: { weightUnit: 'lb', calories: 2000 }, preferences: { welcomed: true }, updatedAt: stamp } as Settings)
const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: today, meal: 'lunch', calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})

const catalog = [
  { id: 'usda-sr-173944', fdcId: 1, name: 'Bananas, raw', category: 'Fruits and Fruit Juices', source: 'USDA SR Legacy', per100g: { calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 }, portions: [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118]] },
  { id: 'usda-sr-174294', fdcId: 2, name: 'Peanut butter, smooth', category: 'Legumes and Legume Products', source: 'USDA SR Legacy', per100g: { calories: 588, protein: 25, carbs: 20, fat: 50 }, portions: [['1 cup', 258], ['2 tbsp', 32]] },
  { id: 'usda-sr-171413', fdcId: 3, name: 'Oil, olive', category: 'Fats and Oils', source: 'USDA SR Legacy', per100g: { calories: 884, protein: 0, carbs: 0, fat: 100 }, portions: [['1 tbsp', 13.5], ['1 cup', 216]] },
  { id: 'usda-sr-168749', fdcId: 4, name: 'Alcoholic beverage, beer, light', category: 'Beverages', source: 'USDA SR Legacy', per100g: { calories: 29, protein: 0.2, carbs: 1.6, fat: 0 }, portions: [['1 fl oz', 29.5], ['1 can or bottle (12 fl oz)', 354]] },
  { id: 'usda-sr-172184', fdcId: 5, name: 'Egg, whole, cooked, hard-boiled', category: 'Dairy and Egg Products', source: 'USDA SR Legacy', per100g: { calories: 155, protein: 12.6, carbs: 1.12, fat: 10.6 }, portions: [['1 large', 50]] },
  { id: 'usda-sr-1', fdcId: 6, name: 'Bread, whole-wheat, toasted', category: 'Baked Products', source: 'USDA SR Legacy', per100g: { calories: 306, protein: 16, carbs: 51, fat: 4 }, portions: [['1 slice', 25]] },
  { id: 'usda-sr-2', fdcId: 7, name: 'Butter, salted', category: 'Dairy and Egg Products', source: 'USDA SR Legacy', per100g: { calories: 717, protein: 1, carbs: 0, fat: 81 }, portions: [['1 pat', 5], ['1 tbsp', 14.2]] },
]

let entries: DiaryEntry[]

beforeEach(() => {
  entries = []
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(settings())
  m.saveSettings.mockResolvedValue(undefined)
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
  window.history.replaceState(null, '', '/')
})

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
const toast = () => document.querySelector('.toast') as HTMLElement | null
const rowOf = (name: string) => screen.getByRole('button', { name: `Actions for ${name}` }).closest('.entry-row') as HTMLElement

describe('tap a row to edit', () => {
  beforeEach(() => { entries = [entry({ id: 'a', name: 'Oats', calories: 150.4 }), entry({ id: 'b', name: 'Soup' })] })

  it('has exactly one Edit control per row, named with the food and its kcal', async () => {
    await renderApp()
    const row = rowOf('Oats')
    const edits = within(row).getAllByRole('button', { name: /^Edit / })
    expect(edits).toHaveLength(1)
    // The name comes from the row's own name and kcal elements plus a hidden "Edit", so a screen reader does not read the row twice.
    expect(edits[0].getAttribute('aria-label')).toBeNull()
    const ids = (edits[0].getAttribute('aria-labelledby') ?? '').split(' ')
    expect(ids).toHaveLength(3)
    expect(ids.map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Edit', 'Oats', '150 kcal'])
    expect(within(row).getByRole('button', { name: /^Edit Oats\s*150\s*kcal$/ })).toBe(edits[0])
    expect(edits[0].className).toContain('entry-edit-hit')
    expect(within(row).queryByRole('button', { name: 'Edit Oats' })).toBeNull()
    // A sibling of the other controls, never wrapping or nested inside one.
    expect(edits[0].parentElement).toBe(row)
    expect(edits[0].querySelector('button')).toBeNull()
    expect(within(row).getByRole('button', { name: 'Drag Oats' }).parentElement).toBe(row)
    expect(within(row).getByRole('button', { name: 'Actions for Oats' }).parentElement).toBe(row)
  })

  it('opens the editor when the row is tapped', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: /^Edit Oats\s*150\s*kcal$/ }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText('Food or meal name') as HTMLInputElement).value).toBe('Oats')
  })

  it('keeps Move, Copy and Delete in the actions, and opening them does not open the editor', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Oats' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const row = rowOf('Oats')
    expect(row.className).toContain('is-open')
    expect(within(row).getByRole('button', { name: 'Move Oats' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Copy Oats to another day' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Delete Oats' })).toBeTruthy()
  })

  it('closes the open actions on a row tap and does not open the editor; the next tap edits', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Oats' }))
    expect(rowOf('Oats').className).toContain('is-open')
    await user.click(screen.getByRole('button', { name: /^Edit Oats\s*150\s*kcal$/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(rowOf('Oats').className).not.toContain('is-open')
    await user.click(screen.getByRole('button', { name: /^Edit Oats\s*150\s*kcal$/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('closes actions opened by a swipe the same way', async () => {
    const user = await renderApp()
    const row = rowOf('Oats')
    vi.useFakeTimers({ toFake: ['Date'] })
    fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 200, clientY: 12 }] })
    expect(row.className).toContain('is-open')
    vi.setSystemTime(Date.now() + 1000)
    await user.click(within(row).getByRole('button', { name: /^Edit Oats/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(row.className).not.toContain('is-open')
  })

  it('works on timeline rows too, with one Edit control', async () => {
    entries = [entry({ id: 'a', name: 'Oats', time: '08:15' })]
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: /Timeline/ }))
    expect(screen.getAllByRole('button', { name: /^Edit Oats/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /^Edit Oats\s*300\s*kcal$/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('default portion in the logger', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, search: string) => {
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), search)
    return dialog
  }
  const amount = (dialog: HTMLElement) => (within(dialog).getByLabelText(/Amount/) as HTMLInputElement).value

  it('starts a banana at 1 medium, 118 g, and its first tap keeps one', async () => {
    const user = await renderApp()
    const dialog = await open(user, 'banana')
    await user.click(await within(dialog).findByRole('button', { name: /^Bananas, raw/ }))
    expect(amount(dialog)).toBe('118')
    const chip = within(dialog).getByRole('button', { name: /1 medium/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await user.click(chip)
    expect(amount(dialog)).toBe('118')
    await user.click(chip)
    expect(amount(dialog)).toBe('236')
  })

  it('starts peanut butter at 2 tbsp, beer at one can, and olive oil at 1 tbsp', async () => {
    const user = await renderApp()
    let dialog = await open(user, 'peanut')
    await user.click(await within(dialog).findByRole('button', { name: /^Peanut butter/ }))
    expect(amount(dialog)).toBe('32')
    expect(within(dialog).getByRole('button', { name: /2 tbsp/ }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(dialog).getByRole('button', { name: 'Back to food search' }))
    await user.clear(within(dialog).getByPlaceholderText(/Search foods/))
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), 'beer')
    await user.click(await within(dialog).findByRole('button', { name: /^Alcoholic beverage, beer, light/ }))
    expect(amount(dialog)).toBe('354')
    expect(within(dialog).getByRole('button', { name: /1 can or bottle/ }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(dialog).getByRole('button', { name: 'Back to food search' }))
    await user.clear(within(dialog).getByPlaceholderText(/Search foods/))
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), 'olive')
    await user.click(await within(dialog).findByRole('button', { name: /^Oil, olive/ }))
    expect(amount(dialog)).toBe('13.5')
    expect(within(dialog).getByRole('button', { name: /1 tbsp/ }).getAttribute('aria-pressed')).toBe('true')
    dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
  })

  it('starts butter at 1 tbsp, not the 5 g pat', async () => {
    const user = await renderApp()
    const dialog = await open(user, 'butter')
    await user.click(await within(dialog).findByRole('button', { name: /^Butter, salted/ }))
    expect(amount(dialog)).toBe('14.2')
    expect(within(dialog).getByRole('button', { name: /1 tbsp/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('applies to the /?log= deep link', async () => {
    window.history.replaceState(null, '', '/?log=usda-sr-173944')
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Bananas, raw')
    await waitFor(() => expect(amount(dialog)).toBe('118'))
  })

  it('keeps a recent entry at its stored grams', async () => {
    entries = [entry({ id: 'r', name: 'Bananas, raw', calories: 178, grams: 200, catalogId: 'usda-sr-173944', catalogSource: 'USDA SR Legacy', date: yesterday })]
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(await waitFor(() => {
      const recent = dialog.querySelector('.recent-result') as HTMLElement | null
      if (!recent) throw new Error('no recent yet')
      return recent
    }))
    await waitFor(() => expect(amount(dialog)).toBe('200'))
    expect(within(dialog).getByRole('button', { name: /1 medium/ }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Undo for bulk adds', () => {
  const described = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), text)
    const card = await within(dialog).findByRole('region', { name: 'Log as a meal' })
    await user.click(within(card).getByRole('button', { name: /^Add \d+ foods?/ }))
  }

  it('describe-to-log keeps typed order and Undo removes exactly those foods, once', async () => {
    entries = [entry({ id: 'old', name: 'Existing' })]
    const user = await renderApp()
    await described(user, '2 eggs and toast with butter')
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved).toHaveLength(3)
    const created = saved.map((item) => Date.parse(item.createdAt))
    expect(created[1] - created[0]).toBe(1)
    expect(created[2] - created[1]).toBe(1)
    await waitFor(() => expect(toast()?.textContent).toContain('Added 3 foods to your diary.'))
    const undo = within(toast() as HTMLElement).getByRole('button', { name: 'Undo' })
    fireEvent.click(undo)
    fireEvent.click(undo)
    await waitFor(() => expect(toast()?.textContent).toContain('Removed 3 foods.'))
    expect(m.deleteEntries).toHaveBeenCalledTimes(1)
    expect(m.deleteEntries.mock.calls[0][0]).toEqual(saved.map((item) => item.id))
    expect(entries.map((item) => item.id)).toEqual(['old'])
    expect(m.deleteEntry).not.toHaveBeenCalled()
  })

  it('shows the described foods in the order they were typed', async () => {
    const user = await renderApp()
    await described(user, 'toast and 2 eggs')
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const names = Array.from(document.querySelectorAll('.entry-row .entry-copy strong')).map((node) => node.textContent)
    expect(names).toEqual(['Bread, whole-wheat, toasted', 'Egg, whole, cooked, hard-boiled'])
  })

  it('reports a failed Undo and leaves the diary alone', async () => {
    const user = await renderApp()
    await described(user, '2 eggs and toast')
    await waitFor(() => expect(toast()?.textContent).toContain('Added 2 foods'))
    m.deleteEntries.mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(toast()?.textContent).toContain('could not be removed'))
    expect(entries).toHaveLength(2)
  })

  it('Copy yesterday offers Undo that removes only the copies', async () => {
    entries = [entry({ id: 'y1', name: 'Yogurt', date: yesterday, time: '08:00' }), entry({ id: 'y2', name: 'Salad', date: yesterday, time: '12:00' }), entry({ id: 't', name: 'Today thing' })]
    vi.stubGlobal('confirm', vi.fn(() => true))
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(toast()?.textContent).toContain('Copied 2 foods'))
    const ids = (m.saveEntries.mock.calls[0][0] as DiaryEntry[]).map((item) => item.id)
    fireEvent.click(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(toast()?.textContent).toContain('Removed 2 foods.'))
    expect(m.deleteEntries.mock.calls[0][0]).toEqual(ids)
    expect(entries.map((item) => item.id).sort()).toEqual(['t', 'y1', 'y2'])
  })

  it('Repeat meal offers Undo', async () => {
    entries = [entry({ id: 'l1', name: 'Rice', date: yesterday }), entry({ id: 'l2', name: 'Beans', date: yesterday })]
    const user = await renderApp()
    await user.click(document.querySelector('#meal-lunch')!.closest('section')!.querySelector('button.repeat-meal') as HTMLElement)
    await waitFor(() => expect(toast()?.textContent).toContain('Repeated lunch'))
    expect(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })
})

describe('Undo keeps what changed since the add, and can be retried', () => {
  const described = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), text)
    const card = await within(dialog).findByRole('region', { name: 'Log as a meal' })
    await user.click(within(card).getByRole('button', { name: /^Add \d+ foods?/ }))
  }

  it('skips an entry edited after the add and says so', async () => {
    const user = await renderApp()
    await described(user, '2 eggs and toast')
    await waitFor(() => expect(toast()?.textContent).toContain('Added 2 foods'))
    const [first] = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    entries = entries.map((item) => (item.id === first.id ? { ...item, updatedAt: '2099-01-01T00:00:00.000Z' } : item))
    fireEvent.click(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(toast()?.textContent).toContain('Removed 1 food.'))
    expect(toast()?.textContent).toContain('1 food was changed since and kept.')
    expect(m.deleteEntries.mock.calls[0][0]).not.toContain(first.id)
    expect(entries.map((item) => item.id)).toEqual([first.id])
  })

  it('does not fail when an entry was already deleted elsewhere', async () => {
    const user = await renderApp()
    await described(user, '2 eggs and toast')
    await waitFor(() => expect(toast()?.textContent).toContain('Added 2 foods'))
    const [first, second] = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    entries = entries.filter((item) => item.id !== first.id)
    fireEvent.click(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(toast()?.textContent).toContain('Removed 1 food.'))
    expect(m.deleteEntries.mock.calls[0][0]).toEqual([second.id])
  })

  it('keeps Undo available after a failure and succeeds on retry', async () => {
    const user = await renderApp()
    await described(user, '2 eggs and toast')
    await waitFor(() => expect(toast()?.textContent).toContain('Added 2 foods'))
    m.deleteEntries.mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(toast()?.textContent).toContain('could not be removed'))
    expect(entries).toHaveLength(2)
    fireEvent.click(within(toast() as HTMLElement).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(toast()?.textContent).toContain('Removed 2 foods.'))
    expect(entries).toHaveLength(0)
  })
})

describe('copying into a day that holds only planned entries', () => {
  const at = (hhmm: string) => { vi.useFakeTimers({ toFake: ['Date'] }); const [h, mm] = hhmm.split(':').map(Number); vi.setSystemTime(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), h, mm, 0)) }

  it('copy yesterday at 06:30, then Copy again: the confirm shows and a declined confirm adds nothing', async () => {
    at('06:30')
    entries = [entry({ id: 'l', name: 'Lunch', date: yesterday, time: '12:30' }), entry({ id: 'd', name: 'Dinner', date: yesterday, time: '19:00' })]
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect((m.saveEntries.mock.calls[0][0] as DiaryEntry[]).every((item) => item.planned === true)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(entries.filter((item) => item.date === today)).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(m.saveEntries).toHaveBeenCalledTimes(1)
    expect(entries.filter((item) => item.date === today)).toHaveLength(2)
  })

  it('Copy day to a date holding only planned entries also asks first', async () => {
    const tomorrow = shiftDate(today, 1)
    entries = [entry({ id: 'a', name: 'Lunch' }), entry({ id: 'p', name: 'Plan', date: tomorrow, planned: true })]
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Copy day to…' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(m.saveEntries).not.toHaveBeenCalled()
  })

  it('Pip does not offer to copy yesterday when today holds only planned entries', async () => {
    const { pickMascotLine } = await import('./lib/mascot')
    const context = { date: today, today, hour: 9, weights: [], goals: undefined, reflux: false }
    const yest = entry({ id: 'y', name: 'Y', date: yesterday })
    expect(pickMascotLine({ ...context, entries: [yest] })?.action).toBe('copy-yesterday')
    expect(pickMascotLine({ ...context, entries: [yest, entry({ id: 'p', name: 'P', planned: true })] })?.action).not.toBe('copy-yesterday')
  })
})

describe('copy times and planned copies', () => {
  const at = (hhmm: string) => { vi.useFakeTimers({ toFake: ['Date'] }); const [h, mm] = hhmm.split(':').map(Number); vi.setSystemTime(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), h, mm, 0)) }

  it('copy yesterday at 08:30 keeps times: later meals today become planned, earlier and untimed stay eaten', async () => {
    at('08:30')
    entries = [
      entry({ id: 'e', name: 'Early', date: yesterday, time: '07:00' }),
      entry({ id: 'n', name: 'Untimed', date: yesterday }),
      entry({ id: 'l', name: 'Lunch', date: yesterday, time: '12:30' }),
      entry({ id: 'd', name: 'Dinner', date: yesterday, time: '19:00' }),
    ]
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    const byName = Object.fromEntries(saved.map((item) => [item.name, item]))
    expect(byName.Early.planned).toBeUndefined()
    expect(byName.Untimed.planned).toBeUndefined()
    expect(byName.Lunch.planned).toBe(true)
    expect(byName.Dinner.planned).toBe(true)
    expect(saved.map((item) => item.time)).toEqual(['07:00', '12:30', '19:00', undefined])
    await waitFor(() => expect(toast()?.textContent).toContain('2 later meals added as planned.'))
  })

  it('a copy within the 60-minute grace window is eaten; beyond it is planned', async () => {
    at('07:55')
    entries = [entry({ id: 'b', name: 'Breakfast', date: yesterday, time: '08:10' }), entry({ id: 'l', name: 'Lunch', date: yesterday, time: '12:30' })]
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.find((item) => item.name === 'Breakfast')?.planned).toBeUndefined()
    expect(saved.find((item) => item.name === 'Lunch')?.planned).toBe(true)
  })

  it('at 06:30 a 12:30 copy is planned and a 07:20 copy is eaten', async () => {
    at('06:30')
    entries = [entry({ id: 'b', name: 'Early', date: yesterday, time: '07:20' }), entry({ id: 'l', name: 'Lunch', date: yesterday, time: '12:30' })]
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.find((item) => item.name === 'Early')?.planned).toBeUndefined()
    expect(saved.find((item) => item.name === 'Lunch')?.planned).toBe(true)
  })

  it('planned copies stay out of the totals', async () => {
    at('08:30')
    entries = [entry({ id: 'e', name: 'Early', date: yesterday, time: '07:00', calories: 200 }), entry({ id: 'd', name: 'Dinner', date: yesterday, time: '19:00', calories: 700 })]
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(toast()?.textContent).toContain('1 later meal added as planned.'))
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(sumEntries(saved).calories).toBe(200)
    expect(document.querySelectorAll('.planned-tag')).toHaveLength(1)
  })

  it('a later destination day marks every copy planned; a past destination is unchanged', async () => {
    at('08:30')
    entries = [entry({ id: 'a', name: 'Lunch', time: '12:00' }), entry({ id: 'b', name: 'Snack' })]
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(screen.getByRole('button', { name: 'Copy day to…' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText('Copy to date') as HTMLInputElement).value).toBe(shiftDate(today, 1))
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved.every((item) => item.planned === true)).toBe(true)
    await waitFor(() => expect(toast()?.textContent).toContain('2 later meals added as planned.'))
  })
})

describe('copies to a past day', () => {
  it('stay eaten', async () => {
    entries = [entry({ id: 'a', name: 'Dinner', time: '19:00' })]
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Copy day to…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Copy to date'), { target: { value: yesterday } })
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const saved = m.saveEntries.mock.calls[0][0] as DiaryEntry[]
    expect(saved[0].planned).toBeUndefined()
    expect(saved[0].time).toBe('19:00')
    await waitFor(() => expect(toast()?.textContent).not.toContain('planned'))
  })
})

describe('planned copies and Pip', () => {
  it('a day holding only planned entries does not count as logged', async () => {
    const { pipGrowth } = await import('./lib/pipGrowth')
    const planned = entry({ id: 'p', name: 'Plan', planned: true })
    expect(pipGrowth([planned], today).days).toBe(0)
    expect(pipGrowth([entry({ id: 'x', name: 'Ate' })], today).days).toBe(1)
  })
})

act // keep the import used when tests are filtered
