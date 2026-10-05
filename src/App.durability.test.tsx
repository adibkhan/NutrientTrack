import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings, WeightEntry } from './types'
import type { DatabaseEvent } from './lib/db'
import { todayISO } from './lib/utils'
import fixtureV1 from './lib/__fixtures__/backup-v1.json'
import { BACKUP_VERSION } from './lib/backup'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined), saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(),
  saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const toastEl = () => document.querySelector('.toast') as HTMLElement | null
const withUnknown = <T extends object>(record: T, extra: Record<string, unknown>) => ({ ...record, ...extra }) as T

const baseEntry: DiaryEntry = {
  id: 'e1', name: 'Porridge', meal: 'breakfast', date: todayISO(), calories: 300,
  protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.saveSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
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

async function editEntry(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Edit ${name}` }))
  return screen.findByRole('dialog')
}

const savedEntry = () => m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>

describe('editing an entry keeps fields this build does not know about', () => {
  it('keeps an unknown field on the saved entry', async () => {
    m.getEntries.mockResolvedValue([withUnknown(baseEntry, { sodium: 120 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.clear(within(dialog).getByLabelText(/^Calories/))
    await user.type(within(dialog).getByLabelText(/^Calories/), '350')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ id: 'e1', calories: 350, sodium: 120, createdAt: stamp })
  })

  it('drops catalogId, catalogSource and grams when a catalog entry is switched to manual', async () => {
    m.getEntries.mockResolvedValue([withUnknown({ ...baseEntry, name: 'Oats', catalogId: 'usda-1', catalogSource: 'USDA SR Legacy' as const, grams: 50 }, { sodium: 5 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Oats')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).not.toHaveProperty('catalogId')
    expect(saved).not.toHaveProperty('catalogSource')
    expect(saved).not.toHaveProperty('grams')
    expect(saved.sodium).toBe(5)
  })

  it('removes time when the time field is cleared', async () => {
    m.getEntries.mockResolvedValue([{ ...baseEntry, time: '08:15' }])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.clear(within(dialog).getByLabelText(/Local time/))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).not.toHaveProperty('time')
  })

  it('keeps foodId on an entry that came from a saved food', async () => {
    m.getEntries.mockResolvedValue([{ ...baseEntry, foodId: 'food-1' }])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().foodId).toBe('food-1')
  })
})

describe('editing a saved food or weight keeps unknown fields', () => {
  it('keeps an unknown field on an edited saved food', async () => {
    const food: Food = { id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp }
    m.getFoods.mockResolvedValue([withUnknown(food, { fiber: 4 })])
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Edit Oats' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save food' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    expect(m.saveFood.mock.calls[0][0]).toMatchObject({ id: 'f1', fiber: 4, createdAt: stamp })
  })

  const weight: WeightEntry = { id: 'w1', date: todayISO(), weight: 180, unit: 'lb', note: 'morning', createdAt: stamp }
  async function editWeight() {
    const user = await renderApp()
    await user.click(first('Trends'))
    await user.click(await screen.findByRole('button', { name: /^Edit weight from/ }))
    return { user, dialog: await screen.findByRole('dialog') }
  }

  it('keeps an unknown field on an edited weight', async () => {
    m.getWeights.mockResolvedValue([withUnknown(weight, { bodyFat: 18 })])
    const { user, dialog } = await editWeight()
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ id: 'w1', bodyFat: 18, note: 'morning' })
  })

  it('removes the note when it is cleared but keeps unknown fields', async () => {
    m.getWeights.mockResolvedValue([withUnknown(weight, { bodyFat: 18 })])
    const { user, dialog } = await editWeight()
    await user.clear(within(dialog).getByLabelText(/^Note/))
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))

    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    const saved = m.saveWeight.mock.calls[0][0]
    expect(saved).not.toHaveProperty('note')
    expect(saved).toMatchObject({ bodyFat: 18 })
  })
})

describe('saving goals', () => {
  it('keeps unknown goal keys and unknown settings fields', async () => {
    const settings = withUnknown({ id: 'profile', goals: withUnknown({ calories: 2000, weightUnit: 'lb' as const }, { fiber: 30 }), updatedAt: stamp } satisfies Settings, { theme: 'dark' })
    m.getSettings.mockResolvedValue(settings)
    const user = await renderApp()
    await user.click(first('Settings'))
    const calories = await screen.findByLabelText(/^Calories/)
    await user.clear(calories)
    await user.type(calories, '2400')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(saved.theme).toBe('dark')
    expect(saved.goals).toMatchObject({ calories: 2400, weightUnit: 'lb', fiber: 30 })
    expect(saved.updatedAt).not.toBe(stamp)
  })

  it('saves goals on a first run with no stored settings', async () => {
    const user = await renderApp()
    await user.click(first('Settings'))
    await user.type(await screen.findByLabelText(/^Calories/), '1800')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(m.saveSettings.mock.calls[0][0]).toMatchObject({ id: 'profile', goals: { calories: 1800, weightUnit: 'lb' } })
  })
})

describe('database events', () => {
  async function renderWithListener() {
    let listener: ((event: DatabaseEvent) => void) | undefined
    const unsubscribe = vi.fn()
    m.onDatabaseEvent.mockImplementation((next) => { listener = next; return unsubscribe })
    const user = await renderApp()
    expect(listener).toBeDefined()
    return { user, emit: (event: DatabaseEvent) => act(() => listener?.(event)), unsubscribe }
  }

  it('shows a persistent error when an upgrade is blocked by another tab', async () => {
    const { emit } = await renderWithListener()
    await emit('blocked')
    expect(await screen.findByText('NutrientTrack is updating. Close its other open tabs to finish.')).toBeTruthy()
    expect(toastEl()?.className).toContain('error')
  })

  it('shows a persistent error when another tab upgraded the database', async () => {
    const { emit } = await renderWithListener()
    await emit('versionchange')
    expect(await screen.findByText('NutrientTrack was updated in another tab. Reload this page to keep saving.')).toBeTruthy()
    expect(toastEl()?.className).toContain('error')
  })

  it('unsubscribes from database events when the app unmounts', async () => {
    const { unsubscribe } = await renderWithListener()
    cleanup()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('importing a backup file', () => {
  const upload = async (user: ReturnType<typeof userEvent.setup>, contents: unknown) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File([JSON.stringify(contents)], 'backup.json', { type: 'application/json' }))
  }

  it('explains that a backup from the next version needs a newer app and imports nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const user = await renderApp()
    await upload(user, { ...fixtureV1, version: BACKUP_VERSION + 1 })

    expect(await screen.findByText('This backup was made by a newer version of NutrientTrack. Reload the app to update, then try again.')).toBeTruthy()
    expect(confirm).not.toHaveBeenCalled()
    expect(m.importBackup).not.toHaveBeenCalled()
  })

  it('still reports a malformed file as not a valid backup', async () => {
    const user = await renderApp()
    await upload(user, { ...fixtureV1, version: 0 })

    expect(await screen.findByText('That file is not a valid NutrientTrack backup.')).toBeTruthy()
    expect(m.importBackup).not.toHaveBeenCalled()
  })

  it('imports the frozen v1 fixture after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.importBackup.mockResolvedValue(undefined)
    m.getEntries.mockResolvedValue([])
    const user = await renderApp()
    await upload(user, fixtureV1)

    await waitFor(() => expect(m.importBackup).toHaveBeenCalledTimes(1))
    // The v1 file is upgraded to the current format on the way in; its records are untouched.
    expect(m.importBackup.mock.calls[0][0]).toMatchObject({ version: BACKUP_VERSION, entries: fixtureV1.entries, settings: fixtureV1.settings, water: [], measurements: [] })
  })
})
