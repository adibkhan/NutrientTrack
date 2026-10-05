// Planned entries: totals, the entry form checkbox, the row tag and Mark as eaten, the day bar and Trends insights.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings } from './types'
import NutritionInsights from './components/NutritionInsights'
import { shiftDate, todayISO } from './lib/utils'

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

const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: todayISO(), meal: 'lunch', calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})
const withUnknown = <T extends object>(record: T, extra: Record<string, unknown>) => ({ ...record, ...extra }) as T

let entries: DiaryEntry[]

beforeEach(() => {
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
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

const summary = () => screen.getByRole('region', { name: 'Daily nutrition summary' })
const bigNumber = () => summary().querySelector('.metric-value')?.firstChild?.textContent?.trim()
const saved = () => m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>

async function openManual(user: ReturnType<typeof userEvent.setup>) {
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Toast')
  await user.type(within(dialog).getByLabelText(/^Calories/), '120')
  return dialog
}

describe('planned entries in totals', () => {
  it('leaves planned calories out of the daily summary', async () => {
    entries = [entry({ id: 'a', name: 'Eaten', calories: 400 }), entry({ id: 'b', name: 'Later', calories: 700, planned: true })]
    await renderApp()
    await screen.findByText('Eaten')
    expect(bigNumber()).toBe('400')
  })

  it('shows zero eaten when the only entry is planned', async () => {
    entries = [entry({ id: 'b', name: 'Later', calories: 700, planned: true })]
    await renderApp()
    await screen.findByText('Later')
    expect(bigNumber()).toBe('0')
  })
})

describe('planned entry row', () => {
  it('shows a Planned tag and a Mark as eaten button only on the planned row', async () => {
    entries = [entry({ id: 'a', name: 'Eaten' }), entry({ id: 'b', name: 'Later', planned: true })]
    await renderApp()
    expect(await screen.findByRole('button', { name: 'Mark Later as eaten' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark Eaten as eaten' })).toBeNull()
    const tags = document.querySelectorAll('.planned-tag')
    expect(tags).toHaveLength(1)
    expect(tags[0].textContent).toBe('Planned')
    expect(tags[0].closest('.entry-row')?.textContent).toContain('Later')
  })

  it('marks eaten: saves without planned, same id, new updatedAt, unknown fields kept, then totals rise', async () => {
    const stored = withUnknown(entry({ id: 'b', name: 'Later', calories: 700, planned: true }), { sodium: 90 })
    entries = [entry({ id: 'a', name: 'Eaten', calories: 400 }), stored]
    m.saveEntry.mockImplementation(async (next) => { entries = entries.map((e) => (e.id === next.id ? next : e)) })
    const user = await renderApp()
    await screen.findByText('Later')
    expect(bigNumber()).toBe('400')

    await user.click(await screen.findByRole('button', { name: 'Mark Later as eaten' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const next = saved()
    expect('planned' in next).toBe(false)
    expect(next).toMatchObject({ id: 'b', name: 'Later', calories: 700, sodium: 90, createdAt: stamp })
    expect(next.updatedAt).not.toBe(stamp)
    await waitFor(() => expect(bigNumber()).toBe('1,100'))
    expect(document.querySelectorAll('.planned-tag')).toHaveLength(0)
  })

  it('does not change anything and reports an error when marking eaten fails', async () => {
    entries = [entry({ id: 'b', name: 'Later', calories: 700, planned: true })]
    m.saveEntry.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Mark Later as eaten' }))
    expect(await screen.findByText('That entry could not be updated. Try again.')).toBeTruthy()
    expect(bigNumber()).toBe('0')
    expect(document.querySelectorAll('.planned-tag')).toHaveLength(1)
  })
})

describe('entry form planned checkbox', () => {
  it('saves planned: true only when the box is checked', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    await user.click(within(dialog).getByRole('checkbox', { name: /Planned, not eaten yet/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved().planned).toBe(true)
  })

  it('omits the planned key when the box is left unchecked', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    expect(within(dialog).getByRole('checkbox', { name: /Planned, not eaten yet/ })).toHaveProperty('checked', false)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect('planned' in saved()).toBe(false)
  })

  it('omits planned when it is checked and then unchecked again', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    const box = within(dialog).getByRole('checkbox', { name: /Planned, not eaten yet/ })
    await user.click(box)
    await user.click(box)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect('planned' in saved()).toBe(false)
  })

  it('removes planned but keeps every unknown field when an existing planned entry is unchecked and saved', async () => {
    entries = [withUnknown(entry({ id: 'p', name: 'Dinner', planned: true }), { sodium: 120, source: 'future-build' })]
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Edit Dinner' }))
    const dialog = await screen.findByRole('dialog')
    const box = within(dialog).getByRole('checkbox', { name: /Planned, not eaten yet/ })
    expect(box).toHaveProperty('checked', true)
    await user.click(box)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect('planned' in saved()).toBe(false)
    expect(saved()).toMatchObject({ id: 'p', sodium: 120, source: 'future-build', createdAt: stamp })
  })

  it('keeps planned and unknown fields when an existing planned entry is edited without touching the box', async () => {
    entries = [withUnknown(entry({ id: 'p', name: 'Dinner', planned: true }), { sodium: 120 })]
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Edit Dinner' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({ planned: true, sodium: 120 })
  })

  it('never sets planned when quick-logging a saved food', async () => {
    const food: Food = { id: 'f1', name: 'Yogurt', serving: '1 cup', calories: 150, protein: 8, carbs: 12, fat: 4, createdAt: stamp, updatedAt: stamp }
    m.getFoods.mockResolvedValue([food])
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: /Yogurt/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: /Planned, not eaten yet/ })).toHaveProperty('checked', false)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect('planned' in saved()).toBe(false)
    expect(saved().foodId).toBe('f1')
  })
})

describe('planned entries and the day strip', () => {
  const todayButton = () => document.querySelector('.date-strip-day.active') as HTMLElement

  it('shows no kcal on a day that only has planned entries', async () => {
    entries = [entry({ id: 'b', name: 'Later', planned: true })]
    await renderApp()
    await screen.findByText('Later')
    expect(todayButton().getAttribute('aria-label')).not.toMatch(/kcal/)
    expect((todayButton().querySelector('.day-bar b') as HTMLElement).style.width).toBe('0%')
  })

  it('counts only the eaten entries on a mixed day', async () => {
    entries = [entry({ id: 'a', name: 'Eaten', calories: 400 }), entry({ id: 'b', name: 'Later', calories: 700, planned: true })]
    await renderApp()
    await screen.findByText('Later')
    expect(todayButton().getAttribute('aria-label')).toMatch(/, 400 kcal$/)
  })
})

describe('planned entries in Nutrition insights', () => {
  const settings = undefined as Settings | undefined

  it('treats a day with only planned entries as no food logged', () => {
    render(<NutritionInsights entries={[entry({ id: 'b', name: 'Later', planned: true })]} goals={settings?.goals} />)
    expect(screen.getByRole('status').textContent).toMatch(/^0 of 7 days logged/)
    expect(screen.getAllByText('No food logged in the last 7 days').length).toBeGreaterThan(0)
  })

  it('counts a day with an eaten entry even when a planned one sits beside it', () => {
    render(<NutritionInsights entries={[entry({ id: 'a', name: 'Eaten' }), entry({ id: 'b', name: 'Later', planned: true, date: shiftDate(todayISO(), -1) })]} />)
    expect(screen.getByRole('status').textContent).toMatch(/^1 of 7 days logged/)
  })
})
