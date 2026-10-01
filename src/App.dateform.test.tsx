// Batch 5 of the UI refresh: meal chips, catalog quick amounts, and the DateNavigator (labels, day bars, date picker).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFood } from './catalog/types'
import type { CloudSync } from './lib/useCloudSync'
import type { DiaryEntry, Settings } from './types'
import { formatNumber, formatShortDate, shiftDate, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

const oats: CatalogFood = {
  id: 'usda-oats', fdcId: 1, name: 'Rolled oats', category: 'Grains', source: 'USDA SR Legacy',
  per100g: { calories: 200, protein: 10, carbs: 20, fat: 5 },
}
vi.mock('./catalog', () => ({
  searchCatalog: vi.fn(async () => [oats]),
  findCatalogFood: vi.fn(async () => oats),
}))

let cloud: CloudSync
vi.mock('./lib/useCloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/useCloudSync')>()),
  useCloudSync: () => cloud,
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'

const fakeCloud = (): CloudSync => ({
  status: 'off',
  email: 'me@example.com',
  sendLink: vi.fn(async () => undefined),
  resetLink: vi.fn(),
  syncNow: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
})

const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: todayISO(), meal: 'breakfast', calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})
const settingsWith = (calories: number | undefined): Settings => ({ id: 'profile', goals: { weightUnit: 'lb', ...(calories === undefined ? {} : { calories }) }, updatedAt: stamp }) as unknown as Settings

let entries: DiaryEntry[]
const realShowPicker = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 5, 10, 8, 15, 0))
  cloud = fakeCloud()
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  if (realShowPicker) Object.defineProperty(HTMLInputElement.prototype, 'showPicker', realShowPicker)
  else delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

async function renderApp() {
  const user = setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}

const savedEntry = (): DiaryEntry => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry
}

describe('Log food meal chips', () => {
  const openManual = async (user: ReturnType<typeof setup>) => {
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    return screen.findByRole('radiogroup', { name: 'Destination meal' })
  }
  const checkedValues = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value)

  it('renders five labelled chips in order with exactly the time-based one selected', async () => {
    const user = await renderApp()
    const group = await openManual(user)
    const labels = Array.from(group.querySelectorAll('label.meal-chip'))
    expect(labels.map((l) => l.textContent)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Other'])
    expect(Array.from(group.querySelectorAll<HTMLInputElement>('input')).map((i) => i.value)).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'other'])
    expect(checkedValues(group)).toEqual(['breakfast'])
    expect(labels.map((l) => l.classList.contains('selected'))).toEqual([true, false, false, false, false])
  })

  it('moves the selection to the clicked chip and persists that meal on save', async () => {
    const user = await renderApp()
    const group = await openManual(user)
    await user.type(screen.getByLabelText('Food or meal name'), 'Toast')
    await user.type(screen.getByLabelText(/^Calories/), '120')
    await user.click(within(group).getByText('Dinner'))
    expect(checkedValues(group)).toEqual(['dinner'])
    const labels = Array.from(group.querySelectorAll('label.meal-chip'))
    expect(labels.map((l) => l.classList.contains('selected'))).toEqual([false, false, true, false, false])
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(savedEntry().meal).toBe('dinner')
    expect(savedEntry().name).toBe('Toast')
  })

  it('keeps a single chip selected after switching twice in a row', async () => {
    const user = await renderApp()
    const group = await openManual(user)
    await user.click(within(group).getByText('Snacks'))
    await user.click(within(group).getByText('Other'))
    expect(checkedValues(group)).toEqual(['other'])
    expect(group.querySelectorAll('label.selected')).toHaveLength(1)
  })

  it('keeps the Date and Local time inputs working', async () => {
    const user = await renderApp()
    await openManual(user)
    const date = screen.getByLabelText('Date') as HTMLInputElement
    const time = screen.getByLabelText(/Local time/) as HTMLInputElement
    expect(date.value).toBe(todayISO())
    fireEvent.change(date, { target: { value: '2026-06-01' } })
    fireEvent.change(time, { target: { value: '13:05' } })
    expect(date.value).toBe('2026-06-01')
    expect(time.value).toBe('13:05')
  })
})

describe('catalog quick amounts', () => {
  const openCatalogForm = async (user: ReturnType<typeof setup>) => {
    await user.click(first('Log food'))
    await user.type(await screen.findByPlaceholderText(/Search foods/), 'oats')
    await user.click(await screen.findByRole('button', { name: /Rolled oats/ }))
    return screen.findByRole('group', { name: 'Quick amounts' })
  }
  const pressed = (group: HTMLElement) => Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-pressed'))
  const selected = (group: HTMLElement) => Array.from(group.querySelectorAll('button')).map((b) => b.classList.contains('selected'))
  const preview = () => Array.from(document.querySelectorAll('.nutrition-preview strong')).map((s) => s.textContent)

  it('offers 50/100/150/200 g with 100 g pressed by default', async () => {
    const user = await renderApp()
    const group = await openCatalogForm(user)
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['50 g', '100 g', '150 g', '200 g'])
    expect((screen.getByLabelText(/Amount/) as HTMLInputElement).value).toBe('100')
    expect(pressed(group)).toEqual(['false', 'true', 'false', 'false'])
    expect(selected(group)).toEqual([false, true, false, false])
  })

  it('sets the amount, rescales the preview and saves the scaled entry with catalog provenance', async () => {
    const user = await renderApp()
    const group = await openCatalogForm(user)
    await user.click(within(group).getByRole('button', { name: '150 g' }))
    expect((document.getElementById('entry-grams') as HTMLInputElement).value).toBe('150')
    expect(pressed(group)).toEqual(['false', 'false', 'true', 'false'])
    expect(selected(group)).toEqual([false, false, true, false])
    expect(preview()).toEqual([`${formatNumber(300, 1)}kcal`, `${formatNumber(15, 1)}g`, `${formatNumber(30, 1)}g`, `${formatNumber(7.5, 1)}g`])
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    const saved = savedEntry()
    expect(saved.grams).toBe(150)
    expect(saved.calories).toBe(300)
    expect(saved.protein).toBe(15)
    expect(saved.carbs).toBe(30)
    expect(saved.fat).toBe(7.5)
    expect(saved.catalogId).toBe('usda-oats')
    expect(saved.catalogSource).toBe('USDA SR Legacy')
  })

  it('moves the pressed state from one chip to another', async () => {
    const user = await renderApp()
    const group = await openCatalogForm(user)
    await user.click(within(group).getByRole('button', { name: '200 g' }))
    await user.click(within(group).getByRole('button', { name: '50 g' }))
    expect(pressed(group)).toEqual(['true', 'false', 'false', 'false'])
    expect(preview()[0]).toBe(`${formatNumber(100, 1)}kcal`)
  })

  it('leaves every chip unpressed for a custom amount and presses 100 g again when typed', async () => {
    const user = await renderApp()
    const group = await openCatalogForm(user)
    const grams = document.getElementById('entry-grams') as HTMLInputElement
    await user.clear(grams)
    await user.type(grams, '120')
    expect(pressed(group)).toEqual(['false', 'false', 'false', 'false'])
    expect(selected(group)).toEqual([false, false, false, false])
    await user.clear(grams)
    await user.type(grams, '100')
    expect(pressed(group)).toEqual(['false', 'true', 'false', 'false'])
  })

  it('leaves every chip unpressed when the amount is cleared', async () => {
    const user = await renderApp()
    const group = await openCatalogForm(user)
    await user.clear(document.getElementById('entry-grams') as HTMLInputElement)
    expect(pressed(group)).toEqual(['false', 'false', 'false', 'false'])
  })
})

describe('DateNavigator day buttons', () => {
  const today = () => todayISO()
  const spoken = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${iso}T12:00:00`))
  const dayButtons = () => Array.from(document.querySelectorAll<HTMLElement>('.date-strip-day'))
  const bar = (index: number) => dayButtons()[index].querySelector('.day-bar > b') as HTMLElement
  const waitStrip = async () => { await screen.findAllByRole('button', { name: 'Log food' }); await vi.waitFor(() => expect(dayButtons()).toHaveLength(7)) }

  it('labels each day with weekday, month and date, plus kcal only when the day has entries', async () => {
    entries = [
      entry({ id: 'a', name: 'A', date: today(), calories: 1234 }),
      entry({ id: 'b', name: 'B', date: today(), calories: 100 }),
      entry({ id: 'c', name: 'C', date: shiftDate(today(), -2), calories: 0 }),
    ]
    await renderApp()
    await waitStrip()
    const labels = dayButtons().map((b) => b.getAttribute('aria-label'))
    const days = Array.from({ length: 7 }, (_, i) => shiftDate(today(), i - 3))
    const expected = days.map((d) => spoken(d))
    expected[3] = `${spoken(days[3])}, ${formatNumber(1334)} kcal`
    expected[1] = `${spoken(days[1])}, ${formatNumber(0)} kcal`
    expect(labels).toEqual(expected)
  })

  it('shows a bar of the goal eaten, clamped to 100%, with over only above the goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith(2000))
    entries = [
      entry({ id: 'a', name: 'A', date: shiftDate(today(), -3), calories: 500 }),
      entry({ id: 'b', name: 'B', date: shiftDate(today(), -2), calories: 2000 }),
      entry({ id: 'c', name: 'C', date: shiftDate(today(), -1), calories: 2500 }),
      entry({ id: 'd', name: 'D', date: today(), calories: 1e9 }),
    ]
    await renderApp()
    await waitStrip()
    await vi.waitFor(() => expect(bar(0).style.width).toBe('25%'))
    expect(bar(1).style.width).toBe('100%')
    expect(bar(1).classList.contains('over')).toBe(false) // exactly at the goal
    expect(bar(2).style.width).toBe('100%')
    expect(bar(2).classList.contains('over')).toBe(true)
    expect(bar(3).style.width).toBe('100%')
    expect(bar(3).classList.contains('over')).toBe(true)
    expect(dayButtons()[3].getAttribute('aria-label')).toContain(formatNumber(1e9))
    expect(bar(4).style.width).toBe('0%') // empty day with a goal
    expect(bar(4).classList.contains('over')).toBe(false)
    for (const b of dayButtons()) expect(b.querySelector('.day-bar > b')?.getAttribute('style')).not.toMatch(/NaN/)
  })

  it('sums several entries on one day into the bar', async () => {
    m.getSettings.mockResolvedValue(settingsWith(1000))
    entries = [entry({ id: 'a', name: 'A', calories: 100 }), entry({ id: 'b', name: 'B', calories: 150 })]
    await renderApp()
    await waitStrip()
    await vi.waitFor(() => expect(bar(3).style.width).toBe('25%'))
  })

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -500],
  ])('with a %s goal the bar is full on days with entries and empty otherwise, never over', async (_n, goal) => {
    m.getSettings.mockResolvedValue(settingsWith(goal))
    entries = [entry({ id: 'a', name: 'A', date: today(), calories: 300 }), entry({ id: 'b', name: 'B', date: shiftDate(today(), 1), calories: 0 })]
    await renderApp()
    await waitStrip()
    await vi.waitFor(() => expect(bar(3).style.width).toBe('100%'))
    expect(bar(4).style.width).toBe('100%') // a zero-calorie entry still counts as logged
    expect(bar(2).style.width).toBe('0%')
    expect(bar(0).style.width).toBe('0%')
    for (const b of dayButtons()) expect(b.querySelector('.day-bar > b')?.classList.contains('over')).toBe(false)
  })

  it('ignores entries outside the seven day strip', async () => {
    m.getSettings.mockResolvedValue(settingsWith(2000))
    entries = [entry({ id: 'a', name: 'A', date: shiftDate(today(), -4), calories: 900 }), entry({ id: 'b', name: 'B', date: shiftDate(today(), 4), calories: 900 })]
    await renderApp()
    await waitStrip()
    await vi.waitFor(() => expect(bar(3).style.width).toBe('0%'))
    for (let i = 0; i < 7; i++) expect(bar(i).style.width).toBe('0%')
    for (const b of dayButtons()) expect(b.getAttribute('aria-label')).not.toMatch(/kcal/)
  })

  it('shows the whole strip empty when there are no entries and no goal', async () => {
    await renderApp()
    await waitStrip()
    for (let i = 0; i < 7; i++) expect(bar(i).style.width).toBe('0%')
  })
})

describe('DateNavigator date picker', () => {
  const picker = () => document.querySelector('input.date-picker-input') as HTMLInputElement
  const pill = () => document.querySelector('.date-pill') as HTMLElement
  const pillText = () => pill().textContent
  const past = () => shiftDate(todayISO(), -9)

  it('has a labelled date input holding the selected date', async () => {
    await renderApp()
    expect(picker().type).toBe('date')
    expect(picker().getAttribute('aria-label')).toBe('Choose date')
    expect(picker().value).toBe(todayISO())
    expect(pillText()).toBe('Today')
  })

  it('selects the chosen day, shows its entries and offers Back to today', async () => {
    entries = [entry({ id: 'p', name: 'Old pancake', date: past() }), entry({ id: 't', name: 'Today toast' })]
    await renderApp()
    expect(await screen.findAllByText('Today toast')).not.toHaveLength(0)
    fireEvent.change(picker(), { target: { value: past() } })
    expect(pillText()).toBe(formatShortDate(past()))
    expect(picker().value).toBe(past())
    expect(await screen.findAllByText('Old pancake')).not.toHaveLength(0)
    expect(screen.queryByText('Today toast')).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to today' })).toBeTruthy()
  })

  it('ignores an empty value', async () => {
    await renderApp()
    fireEvent.change(picker(), { target: { value: past() } })
    fireEvent.change(picker(), { target: { value: '' } })
    expect(pillText()).toBe(formatShortDate(past()))
    expect(screen.getByRole('button', { name: 'Back to today' })).toBeTruthy()
  })

  it('falls back to jumping to today when showPicker is unavailable', async () => {
    expect((HTMLInputElement.prototype as { showPicker?: unknown }).showPicker).toBeUndefined()
    const user = await renderApp()
    fireEvent.change(picker(), { target: { value: past() } })
    expect(pillText()).toBe(formatShortDate(past()))
    await user.click(pill())
    expect(pillText()).toBe('Today')
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()
  })

  it('opens the native picker once and does not change the day when showPicker exists', async () => {
    const showPicker = vi.fn()
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, writable: true, value: showPicker })
    const user = await renderApp()
    fireEvent.change(picker(), { target: { value: past() } })
    await user.click(pill())
    expect(showPicker).toHaveBeenCalledTimes(1)
    expect(showPicker.mock.contexts[0]).toBe(picker())
    expect(pillText()).toBe(formatShortDate(past()))
    expect(picker().value).toBe(past())
  })

  it('does not move to today when showPicker is called from today either', async () => {
    const showPicker = vi.fn()
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, writable: true, value: showPicker })
    const user = await renderApp()
    await user.click(pill())
    await user.click(pill())
    expect(showPicker).toHaveBeenCalledTimes(2)
    expect(pillText()).toBe('Today')
  })

  it('falls back to today when showPicker throws', async () => {
    const showPicker = vi.fn(() => { throw new DOMException('not allowed', 'NotAllowedError') })
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, writable: true, value: showPicker })
    const user = await renderApp()
    fireEvent.change(picker(), { target: { value: past() } })
    await user.click(pill())
    expect(showPicker).toHaveBeenCalledTimes(1)
    expect(pillText()).toBe('Today')
  })
})
