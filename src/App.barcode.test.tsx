// Barcode lookup in the logger. It sends a number to a third party, so it must stay off until the person opts in.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'

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
const CODE = '3017620422003'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const settingsWith = (preferences: Settings['preferences'], extra: Record<string, unknown> = {}): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb' }, preferences, updatedAt: stamp, ...extra }) as Settings

const PRODUCT = {
  status: 1,
  product: {
    product_name: 'Hazelnut spread', brands: 'Nutella, Ferrero',
    nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 3.4, sodium_100g: 0.0107 },
  },
}

let fetchMock: ReturnType<typeof vi.fn>
const foodFactsCalls = () => fetchMock.mock.calls.filter((call) => String(call[0]).includes('openfoodfacts'))

beforeEach(() => {
  fetchMock = vi.fn((url: unknown) => {
    if (String(url).includes('openfoodfacts')) return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(PRODUCT) } as Response)
    return Promise.reject(new Error('offline'))
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.getWaterLogs.mockResolvedValue([])
  m.getMeasurements.mockResolvedValue([])
  m.saveSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
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

async function openScanner() {
  const user = await renderApp()
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Scan barcode/ }))
  const dialog = await screen.findByRole('dialog')
  return { user, dialog }
}

async function lookUp(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, text: string) {
  await user.type(within(dialog).getByLabelText('Barcode number'), text)
  await user.click(within(dialog).getByRole('button', { name: 'Look up' }))
}

describe('barcode lookup is off', () => {
  it('opens Scan a barcode, explains that lookup is off, and sends nothing', async () => {
    const { dialog } = await openScanner()
    expect(within(dialog).getByText('Scan a barcode')).toBeTruthy()
    expect(within(dialog).getByText('Barcode lookup is off')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Turn on barcode lookup' })).toBeTruthy()
    expect(within(dialog).queryByLabelText('Barcode number')).toBeNull()
    expect(foodFactsCalls()).toHaveLength(0)
  })

  it('stays off when the preference is explicitly false or not the boolean true', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ barcodeLookup: 'yes' } as unknown as Settings['preferences']))
    const { dialog } = await openScanner()
    expect(within(dialog).getByText('Barcode lookup is off')).toBeTruthy()
    expect(foodFactsCalls()).toHaveLength(0)
  })

  it('turning it on saves barcodeLookup true and keeps other preferences and unknown settings fields, without any request', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ theme: 'dark', reminders: { logFood: '12:00' }, futurePref: 1 } as Settings['preferences'], { futureSettingsField: { kept: true } }))
    const { user, dialog } = await openScanner()
    await user.click(within(dialog).getByRole('button', { name: 'Turn on barcode lookup' }))

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as Settings & Record<string, unknown>
    expect(saved.preferences).toMatchObject({ barcodeLookup: true, theme: 'dark', reminders: { logFood: '12:00' }, futurePref: 1 })
    expect(saved.futureSettingsField).toEqual({ kept: true })
    expect(foodFactsCalls()).toHaveLength(0)
    expect(await within(dialog).findByLabelText('Barcode number')).toBeTruthy()
  })
})

describe('barcode lookup is on', () => {
  beforeEach(() => {
    m.getSettings.mockResolvedValue(settingsWith({ barcodeLookup: true }))
  })

  it('calls Open Food Facts once with the code in the URL', async () => {
    const { user, dialog } = await openScanner()
    await lookUp(user, dialog, CODE)

    await waitFor(() => expect(foodFactsCalls()).toHaveLength(1))
    const url = new URL(String(foodFactsCalls()[0][0]))
    expect(url.hostname).toBe('world.openfoodfacts.org')
    expect(url.pathname).toContain(CODE)
  })

  it('shows the validation message and does not call fetch for an invalid number', async () => {
    const { user, dialog } = await openScanner()
    await lookUp(user, dialog, '3017620422004')

    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/not a valid barcode number/)
    expect(foodFactsCalls()).toHaveLength(0)
  })

  it('shows not found for an unknown product and lets the person go back', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({}) } as Response))
    const { user, dialog } = await openScanner()
    await lookUp(user, dialog, CODE)
    expect(await within(dialog).findByText('No product found')).toBeTruthy()
  })

  it('shows a failure message when the request fails', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    const { user, dialog } = await openScanner()
    await lookUp(user, dialog, CODE)
    expect(await within(dialog).findByText('Lookup failed')).toBeTruthy()
  })

  it('fills the manual form from a found product and saves grams without a catalogId', async () => {
    const { user, dialog } = await openScanner()
    await lookUp(user, dialog, CODE)
    await within(dialog).findByText('Hazelnut spread')
    const grams = within(dialog).getByLabelText('Amount') as HTMLInputElement
    expect(grams.value).toBe('100')
    await user.clear(grams)
    await user.type(grams, '50')
    await user.click(within(dialog).getByRole('button', { name: 'Use this food' }))

    const form = await screen.findByRole('dialog')
    expect((within(form).getByLabelText('Food or meal name') as HTMLInputElement).value).toBe('Hazelnut spread (Nutella)')
    expect((within(form).getByLabelText(/^Calories/) as HTMLInputElement).value).toBe('269.5')
    expect((within(form).getByLabelText(/^Protein/) as HTMLInputElement).value).toBe('3.15')
    expect((within(form).getByLabelText(/^Carbs/) as HTMLInputElement).value).toBe('28.75')
    expect((within(form).getByLabelText(/^Fat/) as HTMLInputElement).value).toBe('15.45')
    expect((within(form).getByLabelText(/^Fiber/) as HTMLInputElement).value).toBe('1.7')
    expect((within(form).getByLabelText(/^Sodium/) as HTMLInputElement).value).toBe('5.5')
    expect((within(form).getByLabelText(/^Sugar/) as HTMLInputElement).value).toBe('')

    await user.click(within(form).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
    expect(saved).toMatchObject({ name: 'Hazelnut spread (Nutella)', grams: 50, calories: 269.5, fiber: 1.7 })
    expect(saved).not.toHaveProperty('catalogId')
    expect(saved).not.toHaveProperty('catalogSource')
    expect(saved).not.toHaveProperty('sugar')
  })
})

describe('Preferences panel checkbox', () => {
  async function openPreferences() {
    const user = await renderApp()
    await user.click(first('Settings'))
    return { user, box: (await screen.findByRole('checkbox', { name: /Look up barcodes online/ })) as HTMLInputElement }
  }

  it('is unticked by default and saves true when ticked, keeping other fields', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ theme: 'light' }, { futureSettingsField: 5 }))
    const { user, box } = await openPreferences()
    expect(box.checked).toBe(false)
    await user.click(box)

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as Settings & Record<string, unknown>
    expect(saved.preferences).toEqual({ theme: 'light', barcodeLookup: true })
    expect(saved.futureSettingsField).toBe(5)
  })

  it('removes the key when unticked', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ theme: 'light', barcodeLookup: true }))
    const { user, box } = await openPreferences()
    expect(box.checked).toBe(true)
    await user.click(box)

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const preferences = (m.saveSettings.mock.calls[0][0] as Settings).preferences
    expect(preferences).not.toHaveProperty('barcodeLookup')
    expect(preferences).toEqual({ theme: 'light' })
  })
})
