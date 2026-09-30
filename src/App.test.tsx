import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from './types'
import { todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  deleteEntry: vi.fn(),
  deleteFood: vi.fn(),
  deleteWeight: vi.fn(),
  exportBackup: vi.fn(),
  clearAllData: vi.fn(),
  getEntries: vi.fn(),
  getFoods: vi.fn(),
  getSettings: vi.fn(),
  getWeights: vi.fn(),
  importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(),
  saveEntries: vi.fn(),
  saveEntry: vi.fn(),
  saveFood: vi.fn(),
  saveSettings: vi.fn(),
  saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const existingEntry: DiaryEntry = {
  id: 'e1', name: 'Porridge', meal: 'breakfast', date: todayISO(), calories: 300,
  protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp,
}

type User = ReturnType<typeof userEvent.setup>

// Node's process is not in this project's TS types (no @types/node); reach it through globalThis.
const nodeProcess = (globalThis as unknown as {
  process: { on: (e: string, f: (r: unknown) => void) => void; off: (e: string, f: (r: unknown) => void) => void }
}).process

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
  unhandled.length = 0
  nodeProcess.on('unhandledRejection', onUnhandled)
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.deleteEntry.mockResolvedValue(undefined)
})

afterEach(async () => {
  cleanup()
  // let any stray rejection surface before asserting
  await new Promise((resolve) => setTimeout(resolve, 0))
  nodeProcess.off('unhandledRejection', onUnhandled)
  const seen = [...unhandled]
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  expect(seen).toEqual([])
})

const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const toastEl = () => document.querySelector('.toast') as HTMLElement | null

async function renderApp(user: User = userEvent.setup()) {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}

async function openWeightDialog(user: User) {
  await user.click(first('Trends'))
  await user.click(first('Log weight'))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Weight'), '180')
  return dialog
}

async function fillManualEntry(user: User) {
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Toast')
  await user.type(within(dialog).getByLabelText(/^Calories/), '120')
  return dialog
}

async function fillFoodDialog(user: User) {
  await user.click(first('Foods'))
  await user.click(first('Add custom food'))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food name'), 'Oats')
  await user.type(within(dialog).getByLabelText(/^Calories/), '150')
  return dialog
}

describe('write failures surface as error toasts', () => {
  it('shows an error and keeps the dialog open when saving a weight fails', async () => {
    m.saveWeight.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    const dialog = await openWeightDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    expect(await screen.findByText('That weight could not be saved. Try again.')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: /Log weight/ })).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save check-in' })).toHaveProperty('disabled', false)
  })

  it('shows an error and keeps the dialog open when saving a manual entry fails', async () => {
    m.saveEntry.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    const dialog = await fillManualEntry(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    expect(await screen.findByText('That entry could not be saved. Try again.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the dialog open when saving a food fails', async () => {
    m.saveFood.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    const dialog = await fillFoodDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create food' }))
    expect(await screen.findByText('That food could not be saved. Try again.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows an error when deleting an entry fails and keeps the entry visible', async () => {
    m.getEntries.mockResolvedValue([existingEntry])
    m.deleteEntry.mockRejectedValue(new Error('locked'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Delete Porridge' }))
    expect(await screen.findByText('That entry could not be deleted. Try again.')).toBeTruthy()
    expect(m.deleteEntry).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Porridge')).toBeTruthy()
  })

  it('keeps the entry and closes the dialog when only the optional saveFood fails', async () => {
    m.saveFood.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    const dialog = await fillManualEntry(user)
    await user.click(within(dialog).getByLabelText(/Save as reusable food/))
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    expect(await screen.findByText('Entry added, but the food could not be saved for quick logging.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
    expect(m.saveFood).toHaveBeenCalledTimes(1)
    expect(toastEl()?.className).toContain('error')
  })
})

describe('toast lifetime', () => {
  it('keeps an error toast past 4.2s while a success toast disappears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await renderApp(user)
    const dialog = await openWeightDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    expect(await screen.findByText('Weight entry saved.')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(4300) })
    expect(toastEl()).toBeNull()

    m.saveWeight.mockRejectedValue(new Error('disk full'))
    await user.click(first('Log weight'))
    const second = await screen.findByRole('dialog')
    await user.type(within(second).getByLabelText('Weight'), '181')
    await user.click(within(second).getByRole('button', { name: 'Save check-in' }))
    expect(await screen.findByText('That weight could not be saved. Try again.')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.getByText('That weight could not be saved. Try again.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(toastEl()).toBeNull()
  })
})

describe('toast live region', () => {
  it('is mounted before any toast and the toast is inserted inside it', async () => {
    const user = await renderApp()
    const region = document.querySelector('.toast-region') as HTMLElement
    expect(region).toBeTruthy()
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.children.length).toBe(0)
    expect(toastEl()).toBeNull()

    m.saveWeight.mockRejectedValue(new Error('x'))
    const dialog = await openWeightDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    await screen.findByText('That weight could not be saved. Try again.')
    expect(document.querySelector('.toast-region')).toBe(region)
    expect(region.contains(toastEl())).toBe(true)
  })
})

describe('double submit', () => {
  it('calls saveWeight exactly once for repeated submits while saving', async () => {
    let release: () => void = () => {}
    m.saveWeight.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const user = await renderApp()
    const dialog = await openWeightDialog(user)
    const form = dialog.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(m.saveWeight).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: /Saving/ })).toHaveProperty('disabled', true)
    await user.click(within(dialog).getByRole('button', { name: /Saving/ }))
    expect(m.saveWeight).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.saveWeight).toHaveBeenCalledTimes(1)
  })

  it('calls saveFood exactly once for repeated submits while saving', async () => {
    let release: () => void = () => {}
    m.saveFood.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const user = await renderApp()
    const dialog = await fillFoodDialog(user)
    const form = dialog.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(m.saveFood).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: /Saving/ })).toHaveProperty('disabled', true)
    await user.click(within(dialog).getByRole('button', { name: /Saving/ }))
    expect(m.saveFood).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.saveFood).toHaveBeenCalledTimes(1)
  })
})
