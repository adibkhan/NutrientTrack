// Which day a new entry goes to: the viewed day from the Diary, today from everywhere else, and what the toast says.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
const toast = () => document.querySelector('.toast') as HTMLElement | null
const yogurt = { id: 'f-1', name: 'Yogurt', serving: '1 cup', calories: 200, protein: 10, carbs: 20, fat: 6, createdAt: stamp, updatedAt: stamp } as Food

beforeEach(() => {
  // Wednesday 2026-06-10, so the day before is Tue, Jun 9.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0))
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
const viewYesterday = (user: User) => user.click(screen.getByRole('button', { name: 'Previous day' }))
const dateField = () => (screen.getByLabelText('Date') as HTMLInputElement).value
const saved = () => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry
}
const openManual = async (user: User) => { await user.click(await screen.findByRole('button', { name: /Manual quick add/ })) }
async function addManual(user: User) {
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Toast')
  await user.type(within(screen.getByRole('dialog')).getByLabelText(/^Calories/), '120')
  await user.click(screen.getByRole('button', { name: 'Add to diary' }))
  await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
}

describe('Log from outside the Diary uses today', () => {
  it('prefills_today_and_saves_today_when_Log_is_tapped_in_Foods_after_viewing_a_past_day', async () => {
    const user = await renderApp()
    await viewYesterday(user)
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Log' }))
    expect(dateField()).toBe('2026-06-10')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({ name: 'Yogurt', date: '2026-06-10' })
    await waitFor(() => expect(toast()?.textContent).toContain('Entry added to your diary.'))
  })

  it.each(['Trends', 'Foods', 'Settings'])('prefills_today_from_the_top_bar_Log_food_in_%s_after_viewing_a_past_day', async (view) => {
    const user = await renderApp()
    await viewYesterday(user)
    await user.click(first(view))
    await user.click(first('Log food'))
    await openManual(user)
    expect(dateField()).toBe('2026-06-10')
    await addManual(user)
    expect(saved().date).toBe('2026-06-10')
    await waitFor(() => expect(toast()?.textContent).toContain('Entry added to your diary.'))
  })

  it('still_uses_the_viewed_day_from_the_Diary_and_names_that_day_in_the_toast', async () => {
    const user = await renderApp()
    await viewYesterday(user)
    await user.click(first('Log food'))
    await openManual(user)
    expect(dateField()).toBe('2026-06-09')
    await addManual(user)
    expect(saved().date).toBe('2026-06-09')
    await waitFor(() => expect(toast()?.textContent).toContain('Entry added to Tue, Jun 9.'))
    expect(toast()?.textContent).not.toContain('your diary')
  })

  it('says_your_diary_when_logging_for_today_from_the_Diary', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await openManual(user)
    await addManual(user)
    expect(saved().date).toBe('2026-06-10')
    await waitFor(() => expect(toast()?.textContent).toContain('Entry added to your diary.'))
  })

  it('names_the_day_when_the_form_date_is_changed_to_another_day', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await openManual(user)
    const date = screen.getByLabelText('Date')
    await user.clear(date)
    await user.type(date, '2026-06-08')
    const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Toast')
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/^Calories/), '120')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved().date).toBe('2026-06-08')
    await waitFor(() => expect(toast()?.textContent).toContain('Entry added to Mon, Jun 8.'))
  })
})
