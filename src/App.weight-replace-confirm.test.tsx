// Same-day weigh-in: the confirm before replacing, and what an edit that moves onto another record's day does.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightEntry } from './types'
import { formatShortDate, shiftDate, todayISO } from './lib/utils'

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
const today = todayISO()
const day1 = shiftDate(today, -1)
const day2 = shiftDate(today, -2)
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const rec = (id: string, date: string, weight: number, extra: Record<string, unknown> = {}): WeightEntry =>
  ({ id, date, weight, unit: 'lb', createdAt: '2026-01-01T00:00:00.000Z', ...extra }) as WeightEntry

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.deleteWeight.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

async function openTrends(stored: WeightEntry[]) {
  m.getWeights.mockResolvedValue(stored)
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Trends'))
  await screen.findByRole('heading', { name: 'Expenditure' })
  return user
}

async function logNew(stored: WeightEntry[], date: string, value: string) {
  const user = await openTrends(stored)
  await user.click(first('Log weight'))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: date } })
  await user.clear(within(dialog).getByLabelText('Weight'))
  await user.type(within(dialog).getByLabelText('Weight'), value)
  await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
  return dialog
}

async function openEdit(stored: WeightEntry[], editDate: string, newDate: string) {
  const user = await openTrends(stored)
  await user.click(screen.getByRole('button', { name: `Edit weight from ${formatShortDate(editDate)}` }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: newDate } })
  return { user, dialog }
}
const save = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

describe('logging a new weight on a day that already has one', () => {
  it('asks_with_the_existing_value_unit_and_date', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await logNew([rec('a', day1, 180)], day1, '175')
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith(`Replace the 180 lb weigh-in already saved for ${formatShortDate(day1)}?`)
  })

  it('saves_nothing_and_keeps_the_dialog_open_when_declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const dialog = await logNew([rec('a', day1, 180)], day1, '175')
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(m.saveWeight).not.toHaveBeenCalled()
    expect(m.deleteWeight).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBe(dialog)
  })

  it('replaces_the_record_keeping_id_createdAt_and_unknown_fields_when_accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await logNew([rec('a', day1, 180, { futureField: { keep: 'me' } })], day1, '175')
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z', weight: 175, date: day1, futureField: { keep: 'me' } })
    expect(m.deleteWeight).not.toHaveBeenCalled()
    expect(await screen.findByText(`Replaced the weigh-in for ${formatShortDate(day1)}.`)).toBeTruthy()
  })

  it('does_not_ask_on_a_day_with_no_weigh_in', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await logNew([rec('a', day1, 180)], today, '175')
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
    expect(await screen.findByText('Weight entry saved.')).toBeTruthy()
  })
})

describe('editing a weigh-in', () => {
  const stored = () => [rec('own', day2, 181), rec('other', day1, 179)]

  it('saves_the_edited_record_and_deletes_the_displaced_one_when_moved_onto_another_records_day', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, dialog } = await openEdit(stored(), day2, day1)
    await save(user, dialog)
    await waitFor(() => expect(m.deleteWeight).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith(`Replace the 179 lb weigh-in already saved for ${formatShortDate(day1)}?`)
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ id: 'own', date: day1, weight: 181 })
    expect(m.deleteWeight).toHaveBeenCalledWith('other')
  })

  it('changes_nothing_when_the_move_is_declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, dialog } = await openEdit(stored(), day2, day1)
    await save(user, dialog)
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(m.saveWeight).not.toHaveBeenCalled()
    expect(m.deleteWeight).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('refreshes_closes_and_reports_an_error_when_removing_the_displaced_record_fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.deleteWeight.mockRejectedValue(new Error('disk'))
    const { user, dialog } = await openEdit(stored(), day2, day1)
    const before = m.getWeights.mock.calls.length
    await save(user, dialog)
    await waitFor(() => expect(m.deleteWeight).toHaveBeenCalled())
    await waitFor(() => expect(m.getWeights.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const alert = await screen.findByText(/could not be removed/)
    expect(alert.textContent).toContain('earlier weigh-in')
    expect(screen.queryByText(/Replaced the weigh-in/)).toBeNull()
  })

  it('asks_nothing_and_deletes_nothing_when_the_date_is_kept', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, dialog } = await openEdit(stored(), day2, day2)
    await user.clear(within(dialog).getByLabelText('Weight'))
    await user.type(within(dialog).getByLabelText('Weight'), '182')
    await save(user, dialog)
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
    expect(m.deleteWeight).not.toHaveBeenCalled()
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ id: 'own', weight: 182, date: day2 })
    expect(await screen.findByText('Weight entry updated.')).toBeTruthy()
  })
})
