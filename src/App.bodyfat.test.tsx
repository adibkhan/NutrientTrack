// Optional body fat on weight check-ins. Missing means "not recorded"; edits keep unknown fields (invariant 2).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightEntry } from './types'
import { todayISO } from './lib/utils'

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
const RANGE_ERROR = 'Body fat must be a percentage between 1 and 75.'

const weight = (over: Partial<WeightEntry> & Record<string, unknown> = {}): WeightEntry => ({
  id: 'w1', date: todayISO(), weight: 180, unit: 'lb', createdAt: stamp, ...over,
}) as WeightEntry

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
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

async function openNewWeight() {
  const user = await renderApp()
  await user.click(first('Trends'))
  await user.click(first('Log weight'))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Weight'), '180')
  return { user, dialog }
}

async function editWeight() {
  const user = await renderApp()
  await user.click(first('Trends'))
  await user.click(await screen.findByRole('button', { name: /^Edit weight from/ }))
  return { user, dialog: await screen.findByRole('dialog') }
}

const bodyFatBox = (dialog: HTMLElement) => within(dialog).getByLabelText(/^Body fat/) as HTMLInputElement
const savedWeight = () => {
  expect(m.saveWeight).toHaveBeenCalledTimes(1)
  return m.saveWeight.mock.calls[0][0] as WeightEntry & Record<string, unknown>
}

describe('weight form: Body fat', () => {
  it('offers an optional, empty Body fat box', async () => {
    const { dialog } = await openNewWeight()
    expect(bodyFatBox(dialog).value).toBe('')
    expect(within(dialog).getByText('% optional')).toBeTruthy()
  })

  it('saves bodyFat as a number when filled', async () => {
    const { user, dialog } = await openNewWeight()
    await user.type(bodyFatBox(dialog), '18.5')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight().bodyFat).toBe(18.5)
    expect(typeof savedWeight().bodyFat).toBe('number')
  })

  it('omits the bodyFat key when the box is empty', async () => {
    const { user, dialog } = await openNewWeight()
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight()).not.toHaveProperty('bodyFat')
    expect(savedWeight().weight).toBe(180)
  })

  it.each([['1'], ['75']])('accepts the limit value %s', async (value) => {
    const { user, dialog } = await openNewWeight()
    await user.type(bodyFatBox(dialog), value)
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight().bodyFat).toBe(Number(value))
  })

  it.each([['0'], ['76'], ['100']])('shows the range error and does not save %s', async (value) => {
    const { user, dialog } = await openNewWeight()
    await user.type(bodyFatBox(dialog), value)
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(RANGE_ERROR)
    expect(m.saveWeight).not.toHaveBeenCalled()
  })

  it('shows the range error and does not save a negative value', async () => {
    const { user, dialog } = await openNewWeight()
    await user.type(bodyFatBox(dialog), '-3')
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

    expect((await within(dialog).findByRole('alert')).textContent).toBe(RANGE_ERROR)
    expect(m.saveWeight).not.toHaveBeenCalled()
  })

  it('does not save a negative value when Save is pressed either (the box is natively invalid)', async () => {
    const { user, dialog } = await openNewWeight()
    await user.type(bodyFatBox(dialog), '-3')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    expect(m.saveWeight).not.toHaveBeenCalled()
  })

  it('accepts a correction after a rejected value', async () => {
    const { user, dialog } = await openNewWeight()
    await user.type(bodyFatBox(dialog), '76')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    await within(dialog).findByRole('alert')
    await user.clear(bodyFatBox(dialog))
    await user.type(bodyFatBox(dialog), '25')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight().bodyFat).toBe(25)
  })
})

describe('editing a weight that had bodyFat', () => {
  it('shows the stored value and keeps it when untouched', async () => {
    m.getWeights.mockResolvedValue([weight({ bodyFat: 21.4, note: 'morning' })])
    const { user, dialog } = await editWeight()
    expect(bodyFatBox(dialog).value).toBe('21.4')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight()).toMatchObject({ id: 'w1', bodyFat: 21.4, note: 'morning', createdAt: stamp })
  })

  it('removes the bodyFat key when its box is cleared, and keeps the note and unknown fields', async () => {
    m.getWeights.mockResolvedValue([weight({ bodyFat: 21.4, note: 'morning', muscleMass: 70 })])
    const { user, dialog } = await editWeight()
    await user.clear(bodyFatBox(dialog))
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    const saved = savedWeight()
    expect(saved).not.toHaveProperty('bodyFat')
    expect(saved).toMatchObject({ id: 'w1', note: 'morning', muscleMass: 70, createdAt: stamp })
  })

  it('changes bodyFat without touching unknown fields', async () => {
    m.getWeights.mockResolvedValue([weight({ bodyFat: 21.4, muscleMass: 70 })])
    const { user, dialog } = await editWeight()
    await user.clear(bodyFatBox(dialog))
    await user.type(bodyFatBox(dialog), '20')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight()).toMatchObject({ bodyFat: 20, muscleMass: 70 })
  })

  it('does not add a bodyFat key to a weight that never had one, and keeps unknown fields', async () => {
    m.getWeights.mockResolvedValue([weight({ muscleMass: 70 })])
    const { user, dialog } = await editWeight()
    expect(bodyFatBox(dialog).value).toBe('')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight()).not.toHaveProperty('bodyFat')
    expect(savedWeight().muscleMass).toBe(70)
  })

  it('refuses an out-of-range edit and keeps the stored value', async () => {
    m.getWeights.mockResolvedValue([weight({ bodyFat: 21.4 })])
    const { user, dialog } = await editWeight()
    await user.clear(bodyFatBox(dialog))
    await user.type(bodyFatBox(dialog), '76')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(RANGE_ERROR)
    expect(m.saveWeight).not.toHaveBeenCalled()
  })
})

describe('weight log row', () => {
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.weight-row'))
  const noteOf = (row: HTMLElement) => row.querySelector('.weight-note')?.textContent

  async function openTrends() {
    const user = await renderApp()
    await user.click(first('Trends'))
    await screen.findAllByRole('button', { name: /^Edit weight from/ })
  }

  it('shows "N% body fat" in the note column', async () => {
    m.getWeights.mockResolvedValue([weight({ bodyFat: 18.5 })])
    await openTrends()
    expect(noteOf(rows()[0])).toBe('18.5% body fat')
  })

  it('joins the note and body fat with a separator', async () => {
    m.getWeights.mockResolvedValue([weight({ bodyFat: 18, note: 'morning' })])
    await openTrends()
    expect(noteOf(rows()[0])).toBe('morning · 18% body fat')
  })

  it('shows only the note when body fat was not recorded', async () => {
    m.getWeights.mockResolvedValue([weight({ note: 'morning' })])
    await openTrends()
    expect(noteOf(rows()[0])).toBe('morning')
    expect(rows()[0].textContent).not.toContain('body fat')
  })

  it('shows nothing in the note column when neither is recorded', async () => {
    m.getWeights.mockResolvedValue([weight()])
    await openTrends()
    expect(noteOf(rows()[0])).toBe('')
  })
})
