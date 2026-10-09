// Settings > Goals: the optional starting-estimate calculator. Nothing typed is stored; results only fill the calorie box when asked.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, WeightEntry } from './types'
import { estimateMaintenance } from './lib/startingEstimate'
import { budgetFor } from './lib/program'
import { CM_PER_INCH } from './lib/measurements'
import { LB_PER_KG } from './lib/trend'

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

const settingsRecord = (goals: Record<string, unknown>, program?: unknown): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb', ...goals }, preferences: { theme: 'light' }, futureTopLevel: { keep: 'me' }, ...(program ? { program } : {}), updatedAt: stamp }) as unknown as Settings

let stored: Settings | undefined

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  stored = undefined
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockImplementation(async () => stored)
  m.saveSettings.mockResolvedValue(undefined)
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

async function openSettings() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Settings'))
  await screen.findByRole('heading', { name: 'Program' })
  return user
}
const age = () => screen.getByLabelText('Age') as HTMLInputElement
const height = () => screen.getByLabelText(/^Height/) as HTMLInputElement
const weight = () => screen.getByLabelText(/^Weight/, { selector: '#est-weight' }) as HTMLInputElement
const calories = () => screen.getByLabelText(/^Calories/) as HTMLInputElement
const fmt = (n: number) => n.toLocaleString('en-US')
const savedSettings = () => m.saveSettings.mock.calls.at(-1)?.[0] as unknown as Record<string, any>

async function type(user: ReturnType<typeof userEvent.setup>, a: string, h: string, w: string) {
  await user.type(age(), a)
  await user.type(height(), h)
  if (w) await user.type(weight(), w)
}

describe('Settings: stance text', () => {
  it('says the app only suggests a target when asked, from numbers it does not keep', async () => {
    await openSettings()
    expect(screen.getByText('NutrientTrack only suggests a target when you ask for one, from numbers you type and it does not keep. It makes no health recommendations.')).toBeTruthy()
  })
})

describe('Settings: starting estimate', () => {
  it('offers an Estimate a starting target disclosure that starts without a figure', async () => {
    await openSettings()
    expect(screen.getByText('Estimate a starting target')).toBeTruthy()
    expect(screen.queryByText('Estimated maintenance')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use maintenance as my goal' })).toBeNull()
  })

  it('shows the estimated maintenance once age, height and weight are typed (pounds and inches)', async () => {
    const user = await openSettings()
    await type(user, '35', '67', '154')
    const expected = estimateMaintenance({ formula: 'female', age: 35, heightCm: 67 * CM_PER_INCH, weightKg: 154 / LB_PER_KG, activity: 'light' })!
    expect(screen.getByText('Estimated maintenance')).toBeTruthy()
    expect(screen.getByText(`${fmt(expected)} kcal / day`)).toBeTruthy()
  })

  it('puts the figure in the Calories box without saving until Save goals', async () => {
    const user = await openSettings()
    await type(user, '35', '67', '154')
    const expected = estimateMaintenance({ formula: 'female', age: 35, heightCm: 67 * CM_PER_INCH, weightKg: 154 / LB_PER_KG, activity: 'light' })!
    await user.click(screen.getByRole('button', { name: 'Use maintenance as my goal' }))
    expect(calories().value).toBe(String(expected))
    expect(m.saveSettings).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().goals.calories).toBe(expected)
  })

  it('stores nothing that was typed: saved settings have no age, height, sex or weight keys', async () => {
    stored = settingsRecord({ calories: 1800 })
    const user = await openSettings()
    await type(user, '35', '67', '154')
    await user.selectOptions(screen.getByLabelText('Formula'), 'male')
    await user.click(screen.getByRole('button', { name: 'Use maintenance as my goal' }))
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const json = JSON.stringify(savedSettings())
    expect(json).not.toMatch(/age|height|sex|formula|activity|"est/i)
    expect(Object.keys(JSON.parse(json).goals).sort()).toEqual(['calories', 'weightUnit'])
    expect(savedSettings().futureTopLevel).toEqual({ keep: 'me' })
  })

  it('uses the male formula when chosen', async () => {
    const user = await openSettings()
    await type(user, '35', '67', '154')
    await user.selectOptions(screen.getByLabelText('Formula'), 'male')
    const expected = estimateMaintenance({ formula: 'male', age: 35, heightCm: 67 * CM_PER_INCH, weightKg: 154 / LB_PER_KG, activity: 'light' })!
    expect(screen.getByText(`${fmt(expected)} kcal / day`)).toBeTruthy()
  })

  it('applies the chosen activity level', async () => {
    const user = await openSettings()
    await type(user, '35', '67', '154')
    await user.selectOptions(screen.getByLabelText('Activity'), 'active')
    const expected = estimateMaintenance({ formula: 'female', age: 35, heightCm: 67 * CM_PER_INCH, weightKg: 154 / LB_PER_KG, activity: 'active' })!
    expect(screen.getByText(`${fmt(expected)} kcal / day`)).toBeTruthy()
  })

  it('asks for more input and shows no figure for an out-of-range age', async () => {
    const user = await openSettings()
    await type(user, '10', '67', '154')
    expect(screen.queryByText('Estimated maintenance')).toBeNull()
    expect(screen.getByText('Enter your age, height and weight to see an estimate.')).toBeTruthy()
  })

  it('lets kg users type centimetres and kilograms and gives the same estimate as the equivalent pounds and inches', async () => {
    stored = settingsRecord({}, undefined)
    const lbUser = await openSettings()
    await type(lbUser, '35', '67', '154')
    const lbText = screen.getByText('Estimated maintenance').nextElementSibling?.textContent
    cleanup()

    stored = settingsRecord({ weightUnit: 'kg' })
    const kgUser = await openSettings()
    expect(screen.getByText('cm', { selector: '#est-height ~ *, label span' })).toBeTruthy()
    await type(kgUser, '35', String(67 * CM_PER_INCH), String(154 / LB_PER_KG))
    expect(screen.getByText('Estimated maintenance').nextElementSibling?.textContent).toBe(lbText)
    expect(height().placeholder).toBe('170')
  })

  it('shows inches in the height label for pounds users', async () => {
    await openSettings()
    expect(height().placeholder).toBe('67')
    expect(screen.getByText('in', { selector: 'label span' })).toBeTruthy()
  })

  it('falls back to the trend weight when the weight box is empty, and shows it as the placeholder', async () => {
    const weights: WeightEntry[] = [{ id: 'w1', date: '2026-03-01', weight: 154, unit: 'lb', createdAt: stamp }]
    m.getWeights.mockResolvedValue(weights)
    const user = await openSettings()
    expect(weight().placeholder).toBe('154')
    await type(user, '35', '67', '')
    const expected = estimateMaintenance({ formula: 'female', age: 35, heightCm: 67 * CM_PER_INCH, weightKg: 154 / LB_PER_KG, activity: 'light' })!
    expect(screen.getByText(`${fmt(expected)} kcal / day`)).toBeTruthy()
  })

  it('shows no figure without a typed weight or any weigh-in', async () => {
    const user = await openSettings()
    await type(user, '35', '67', '')
    expect(screen.queryByText('Estimated maintenance')).toBeNull()
  })

  it('does not submit the goals form when Enter is pressed in an estimate input', async () => {
    const user = await openSettings()
    await type(user, '35', '67', '154')
    await user.type(weight(), '{Enter}')
    await user.type(age(), '{Enter}')
    fireEvent.keyDown(height(), { key: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('still submits the goals form on Enter in the Calories box', async () => {
    const user = await openSettings()
    await user.type(calories(), '2000{Enter}')
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
  })

  it('shows the program budget button only with a saved program that has what it needs', async () => {
    stored = settingsRecord({}, { direction: 'lose', weeklyRate: 1 })
    const user = await openSettings()
    expect(screen.queryByRole('button', { name: 'Use the program budget' })).toBeNull()
    await type(user, '35', '67', '154')
    expect(screen.getByRole('button', { name: 'Use the program budget' })).toBeTruthy()
    expect(screen.getByText('For your program')).toBeTruthy()
  })

  it('has no program budget button without a program, or for lose without a rate', async () => {
    stored = settingsRecord({}, { direction: 'lose' })
    const user = await openSettings()
    await type(user, '35', '67', '154')
    expect(screen.getByRole('button', { name: 'Use maintenance as my goal' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use the program budget' })).toBeNull()
  })

  it('fills the Calories box with budgetFor on maintenance for the program, without saving', async () => {
    stored = settingsRecord({}, { direction: 'lose', weeklyRate: 1, futureField: 'pf' })
    const user = await openSettings()
    await type(user, '35', '67', '154')
    const maintenance = estimateMaintenance({ formula: 'female', age: 35, heightCm: 67 * CM_PER_INCH, weightKg: 154 / LB_PER_KG, activity: 'light' })!
    const expected = budgetFor({ direction: 'lose', weeklyRate: 1 }, 'lb', maintenance, 154).calories
    expect(expected).toBeLessThan(maintenance)
    await user.click(screen.getByRole('button', { name: 'Use the program budget' }))
    expect(calories().value).toBe(String(expected))
    expect(m.saveSettings).not.toHaveBeenCalled()
  })
})

describe('Settings: program diet style through the app', () => {
  it('saves a chosen diet style and keeps unknown fields on the stored program', async () => {
    stored = settingsRecord({}, { direction: 'maintain', futureField: 'x' })
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Diet style'), 'keto')
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().program).toEqual({ direction: 'maintain', futureField: 'x', dietStyle: 'keto' })
  })

  it('removes dietStyle from the stored program when balanced is chosen again, keeping unknown fields', async () => {
    stored = settingsRecord({}, { direction: 'maintain', dietStyle: 'keto', futureField: 'x' })
    const user = await openSettings()
    expect((screen.getByLabelText('Diet style') as HTMLSelectElement).value).toBe('keto')
    await user.selectOptions(screen.getByLabelText('Diet style'), '')
    await user.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(savedSettings().program).toEqual({ direction: 'maintain', futureField: 'x' })
    expect('dietStyle' in savedSettings().program).toBe(false)
  })
})
