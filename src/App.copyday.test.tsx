// Copy day: the diary header button copies the previous day's eaten entries to the viewed date.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, WeightEntry } from './types'
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
const today = todayISO()
const yesterday = shiftDate(today, -1)
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: yesterday, meal: 'lunch', calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})

let entries: DiaryEntry[]

beforeEach(() => {
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([] as Food[])
  m.getWeights.mockResolvedValue([] as WeightEntry[])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
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

const copyButton = (label: string) => screen.getByRole('button', { name: label }) as HTMLButtonElement
const toast = () => document.querySelector('.toast') as HTMLElement | null
const copies = () => m.saveEntries.mock.calls[0][0] as Array<DiaryEntry & Record<string, unknown>>

describe('Copy yesterday', () => {
  it('is labelled Copy yesterday on today and Copy previous day on another date', async () => {
    const user = await renderApp()
    expect(copyButton('Copy yesterday')).toBeTruthy()
    await user.click(first('Previous day'))
    expect(copyButton('Copy previous day')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy yesterday' })).toBeNull()
  })

  it('is disabled when the previous day has no entries', async () => {
    await renderApp()
    expect(copyButton('Copy yesterday').disabled).toBe(true)
  })

  it('is disabled when the previous day only has planned entries', async () => {
    entries = [entry({ id: 'p', name: 'Later', planned: true })]
    await renderApp()
    await screen.findByRole('button', { name: 'Copy yesterday' })
    expect(copyButton('Copy yesterday').disabled).toBe(true)
  })

  it('copies eaten entries to today with new ids, fresh timestamps and unknown fields, and skips planned ones', async () => {
    const eaten = { ...entry({ id: 'a', name: 'Porridge', time: '08:00', grams: 50, calories: 250 }), sodium: 40 } as DiaryEntry
    entries = [eaten, entry({ id: 'p', name: 'Later', planned: true }), entry({ id: 'old', name: 'Older', date: shiftDate(today, -2) })]
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Copy yesterday' }))

    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = copies()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'Porridge', date: today, time: '08:00', grams: 50, calories: 250, sodium: 40 })
    expect(saved[0].id).not.toBe('a')
    expect(saved[0].createdAt).not.toBe(stamp)
    expect(saved[0].updatedAt).toBe(saved[0].createdAt)
    expect('planned' in saved[0]).toBe(false)
    expect(await screen.findByText(/Copied 1 food from/)).toBeTruthy()
    expect(entries.find((e) => e.id === 'a')?.date).toBe(yesterday)
  })

  it('does not ask for confirmation when the viewed day has no eaten entries, even with a planned one', async () => {
    entries = [entry({ id: 'a', name: 'Porridge' }), entry({ id: 'tp', name: 'Planned today', date: today, planned: true })]
    const confirm = vi.spyOn(window, 'confirm')
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks first when the viewed day already has eaten entries and does nothing if declined', async () => {
    entries = [entry({ id: 'a', name: 'Porridge' }), entry({ id: 'now', name: 'Toast', date: today })]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Copy yesterday' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(m.saveEntries).not.toHaveBeenCalled()
  })

  it('copies after the user confirms', async () => {
    entries = [entry({ id: 'a', name: 'Porridge' }), entry({ id: 'now', name: 'Toast', date: today })]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Copy yesterday' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(copies()).toHaveLength(1)
  })

  it('announces an error and adds nothing when saveEntries rejects', async () => {
    entries = [entry({ id: 'a', name: 'Porridge' })]
    m.saveEntries.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Copy yesterday' }))
    expect(await screen.findByText('That day could not be copied. Nothing was added.')).toBeTruthy()
    expect(toast()?.className).toMatch(/error/)
    expect(entries).toHaveLength(1)
    expect(within(document.body).queryByText(/Copied \d/)).toBeNull()
  })

  it('copies from the day before the viewed date, not from yesterday, when browsing another day', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true) // the viewed day already has an entry
    entries = [entry({ id: 'a', name: 'Today-1' }), entry({ id: 'b', name: 'Two days ago', date: shiftDate(today, -2) })]
    const user = await renderApp()
    await user.click(first('Previous day'))
    await user.click(await screen.findByRole('button', { name: 'Copy previous day' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(copies().map((c) => [c.name, c.date])).toEqual([['Two days ago', yesterday]])
  })
})
