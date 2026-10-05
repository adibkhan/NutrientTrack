// Body measurements on Trends: optional parts (missing means not measured), one record per day, edits keep unknown fields.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BodyMeasurement, Settings } from './types'
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
const PARTS = ['waist', 'hips', 'chest', 'arm', 'thigh'] as const

const rec = (date: string, extra: Record<string, unknown> = {}): BodyMeasurement =>
  ({ id: date, date, unit: 'in', waist: 34, createdAt: stamp, updatedAt: stamp, ...extra }) as BodyMeasurement

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.getWaterLogs.mockResolvedValue([])
  m.getMeasurements.mockResolvedValue([])
  m.saveMeasurement.mockResolvedValue(undefined)
  m.deleteMeasurement.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openTrends() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Trends'))
  await screen.findByRole('heading', { name: 'Body measurements' })
  return user
}

async function openDialog() {
  const user = await openTrends()
  await user.click(screen.getByRole('button', { name: 'Log measurements' }))
  return { user, dialog: await screen.findByRole('dialog') }
}

const box = (dialog: HTMLElement, label: RegExp) => within(dialog).getByLabelText(label) as HTMLInputElement
const saved = () => {
  expect(m.saveMeasurement).toHaveBeenCalledTimes(1)
  return m.saveMeasurement.mock.calls[0][0] as BodyMeasurement & Record<string, unknown>
}
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.measurement-row'))
const rowFor = (label: string) => rows().find((row) => row.textContent?.startsWith(label)) as HTMLElement
const historyRows = () => Array.from(document.querySelectorAll<HTMLElement>('.measurement-history .tool-row'))

describe('Body measurements panel', () => {
  it('opens the Log measurements dialog with an empty form dated today', async () => {
    const { dialog } = await openDialog()
    expect(within(dialog).getByText('Log measurements')).toBeTruthy()
    expect(box(dialog, /^Date/).value).toBe(todayISO())
    for (const label of [/^Waist/, /^Hips/, /^Chest/, /^Arm/, /^Thigh/]) expect(box(dialog, label).value).toBe('')
  })

  it('saves waist 34.5 with the chosen date as id, unit in, and no other part keys', async () => {
    const { user, dialog } = await openDialog()
    fireEvent.change(box(dialog, /^Date/), { target: { value: '2026-02-10' } })
    await user.type(box(dialog, /^Waist/), '34.5')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveMeasurement).toHaveBeenCalledTimes(1))
    const record = saved()
    expect(record).toMatchObject({ id: '2026-02-10', date: '2026-02-10', unit: 'in', waist: 34.5 })
    for (const part of PARTS.filter((key) => key !== 'waist')) expect(record).not.toHaveProperty(part)
    expect(m.deleteMeasurement).not.toHaveBeenCalled()
  })

  it('saves in centimetres for kilogram users', async () => {
    m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'kg' }, updatedAt: stamp } as Settings)
    const { user, dialog } = await openDialog()
    await user.type(box(dialog, /^Waist/), '88')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveMeasurement).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({ id: todayISO(), unit: 'cm', waist: 88 })
  })

  it('refuses an all-empty form', async () => {
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Enter at least one measurement.')
    expect(m.saveMeasurement).not.toHaveBeenCalled()
  })

  it('refuses a negative value', async () => {
    const { user, dialog } = await openDialog()
    await user.type(box(dialog, /^Hips/), '-3')
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Hips must be a number greater than zero.')
    expect(m.saveMeasurement).not.toHaveBeenCalled()
  })

  it('refuses a zero value', async () => {
    const { user, dialog } = await openDialog()
    await user.type(box(dialog, /^Chest/), '0')
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Chest must be a number greater than zero.')
    expect(m.saveMeasurement).not.toHaveBeenCalled()
  })

  it('refuses a cleared date', async () => {
    const { user, dialog } = await openDialog()
    await user.type(box(dialog, /^Waist/), '30')
    fireEvent.change(box(dialog, /^Date/), { target: { value: '' } })
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Choose a date.')
    expect(m.saveMeasurement).not.toHaveBeenCalled()
  })
})

describe('measurement table', () => {
  it('shows the latest waist and its 30-day change', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-01', { waist: 35 }), rec('2026-03-20', { waist: 34.5 })])
    await openTrends()
    const row = rowFor('Waist')
    expect(within(row).getByText('34.5 in')).toBeTruthy()
    expect(within(row).getByText('−0.5 in')).toBeTruthy()
  })

  it('shows a plus sign for a gain', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-01', { arm: 12 }), rec('2026-03-20', { arm: 12.5 })])
    await openTrends()
    expect(within(rowFor('Arm')).getByText('+0.5 in')).toBeTruthy()
  })

  it('shows a dash when there is only one reading', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-20', { waist: 34.5 })])
    await openTrends()
    expect(within(rowFor('Waist')).getByText('—')).toBeTruthy()
  })

  it('shows a dash when the earlier reading is older than 30 days', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-01-01', { waist: 36 }), rec('2026-03-20', { waist: 34.5 })])
    await openTrends()
    expect(within(rowFor('Waist')).getByText('—')).toBeTruthy()
  })

  it('lists only measured parts and shows the empty prompt with none', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-20', { waist: 34.5 })])
    await openTrends()
    expect(rows().map((row) => row.textContent?.slice(0, 5))).toEqual(['Waist'])
    cleanup()
    m.getMeasurements.mockResolvedValue([])
    await openTrends()
    expect(rows()).toHaveLength(0)
    expect(screen.getByText(/Log a waist, hips, chest, arm or thigh measurement/)).toBeTruthy()
  })
})

describe('editing and deleting a check-in', () => {
  const editButton = async () => screen.findByRole('button', { name: /^Edit measurements from/ })

  it('removes the hips key when hips is cleared, and keeps unknown fields, createdAt and other parts', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-01', { waist: 34, hips: 40, futureField: { kept: true } })])
    const user = await openTrends()
    await user.click(await editButton())
    const dialog = await screen.findByRole('dialog')
    expect(box(dialog, /^Hips/).value).toBe('40')
    await user.clear(box(dialog, /^Hips/))
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveMeasurement).toHaveBeenCalledTimes(1))
    const record = saved()
    expect(record).not.toHaveProperty('hips')
    expect(record).toMatchObject({ id: '2026-03-01', waist: 34, createdAt: stamp, futureField: { kept: true } })
    expect(m.deleteMeasurement).not.toHaveBeenCalled()
  })

  const moveToNewDate = async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-01', { waist: 34, futureField: 7 })])
    const user = await openTrends()
    await user.click(await editButton())
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(box(dialog, /^Date/), { target: { value: '2026-03-05' } })
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => expect(m.deleteMeasurement).toHaveBeenCalledWith('2026-03-01'))
  }

  it('saves under the new id and deletes the old one when the date changes', async () => {
    await moveToNewDate()
    expect(saved()).toMatchObject({ id: '2026-03-05', date: '2026-03-05', waist: 34 })
  })

  // KNOWN DEFECT (invariant 2): saveMeasurementEntry only starts from `existing` when the id is unchanged, so moving a
  // check-in to an empty date drops the record's unknown fields and createdAt. it.fails turns green when that is fixed;
  // then change it to a plain `it`.
  it('keeps unknown fields and createdAt when a check-in moves to a new date', async () => {
    await moveToNewDate()
    expect(saved()).toMatchObject({ id: '2026-03-05', futureField: 7, createdAt: stamp })
  })

  it('does not delete when the confirmation is declined', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-01')])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await openTrends()
    await user.click(await screen.findByRole('button', { name: /^Delete measurements from/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(m.deleteMeasurement).not.toHaveBeenCalled()
  })

  it('deletes the record once the confirmation is accepted', async () => {
    m.getMeasurements.mockResolvedValue([rec('2026-03-01')])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await openTrends()
    await user.click(await screen.findByRole('button', { name: /^Delete measurements from/ }))
    await waitFor(() => expect(m.deleteMeasurement).toHaveBeenCalledWith('2026-03-01'))
  })
})

describe('check-in history', () => {
  it('lists 3 rows and offers Show all N, then Show fewer', async () => {
    m.getMeasurements.mockResolvedValue(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].map((date) => rec(date)))
    const user = await openTrends()
    expect(historyRows()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Show all 5' }))
    expect(historyRows()).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(historyRows()).toHaveLength(3)
  })

  it('has no Show all button at exactly 3 check-ins', async () => {
    m.getMeasurements.mockResolvedValue(['2026-03-01', '2026-03-02', '2026-03-03'].map((date) => rec(date)))
    await openTrends()
    expect(historyRows()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull()
  })
})
