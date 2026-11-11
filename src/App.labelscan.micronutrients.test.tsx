// Label scan with micronutrients and the plate: the five newly storable nutrients fill their boxes, a flagged one still gates saving, and the form can add to a plate.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings } from './types'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteEntries: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))
vi.mock('./lib/labelRead', () => ({ readLabelPhoto: vi.fn() }))
vi.mock('./lib/labelOcr', () => ({ releaseOcr: vi.fn(() => Promise.resolve()), recognizeText: vi.fn() }))

import * as db from './lib/db'
import { readLabelPhoto } from './lib/labelRead'
import { parseLabel } from './lib/labelParse'
import App from './App'

const m = vi.mocked(db)
vi.setConfig({ testTimeout: 30000 })
const stamp = '2026-01-01T00:00:00.000Z'
const photo = () => new File(['x'], 'label.jpg', { type: 'image/jpeg' })
const reading = (text: string) => vi.mocked(readLabelPhoto).mockResolvedValue({ parsed: parseLabel(text), text, lines: [], rotation: 0, ms: 1 })
const LABEL = 'Nutrition Facts\nServing size 1 cup (240g)\nCalories 120\nTotal Fat 4g 5%\nTrans Fat 0.5g\nTotal Carbohydrate 15g 5%\nIncludes 4g Added Sugars 8%\nProtein 8g\nVitamin D 2.5mcg 13%\nCalcium 300mg 23%\nIron 1mg 6%\nPotassium 400mg 9%'
const welcomed: Settings = { id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp }
const bar: Food = { id: 'f1', name: 'Protein bar', serving: '1 bar', calories: 210, protein: 20, carbs: 22, fat: 7, createdAt: stamp, updatedAt: stamp }
let entries: DiaryEntry[]

const originalCreate = URL.createObjectURL
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  entries = []
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([bar])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(welcomed)
  m.saveEntry.mockResolvedValue(undefined as never)
  m.saveFood.mockResolvedValue(undefined as never)
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
})
afterEach(() => { cleanup(); URL.createObjectURL = originalCreate; vi.unstubAllGlobals(); vi.resetAllMocks() })

type User = ReturnType<typeof userEvent.setup>
const openLogger = async (user: User) => { await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0]); await screen.findByRole('dialog') }
const scan = async (user: User) => {
  const group = await screen.findByRole('group', { name: 'Other ways to log' })
  await user.click(within(group).getByRole('button', { name: 'Scan label' }))
  await user.upload(await screen.findByLabelText('Choose a photo of the label'), photo())
  await user.click(await screen.findByRole('button', { name: /Use these values/ }))
}
const box = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement

describe('label scan fills the micronutrient boxes', () => {
  it('puts trans fat, vitamin D, calcium, iron and potassium in their boxes, scales them by servings and stores them per serving on the reusable food', async () => {
    reading(LABEL)
    const user = userEvent.setup()
    render(<App />)
    await openLogger(user)
    await scan(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Yogurt drink')
    expect(box(/^Trans fat/).value).toBe('0.5')
    expect(box(/^Vitamin D/).value).toBe('2.5')
    expect(box(/^Calcium/).value).toBe('300')
    expect(box(/^Iron/).value).toBe('1')
    expect(box(/^Potassium/).value).toBe('400')
    expect(screen.getByRole('note', { name: 'About the scanned label' }).textContent).toContain('added sugars 4 g')
    await user.clear(screen.getByLabelText('Servings'))
    await user.type(screen.getByLabelText('Servings'), '2')
    expect(box(/^Potassium/).value).toBe('800')
    const submit = screen.getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    await user.click(submit)
    await waitFor(() => expect(m.saveFood).toHaveBeenCalled())
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ name: 'Yogurt drink', servings: 2, potassium: 800, calcium: 600, iron: 2, vitaminD: 5, transFat: 1 })
    expect(m.saveFood.mock.calls[0][0]).toMatchObject({ calories: 120, potassium: 400, calcium: 300, iron: 1, vitaminD: 2.5, transFat: 0.5 })
  })

  it('opens the full nutrient list for a flagged micronutrient and blocks saving until it is edited or confirmed', async () => {
    reading('Nutrition Facts\nServing size 1 cup (240g)\nCalories 120\nTotal Fat 4g 5%\nTotal Carbohydrate 15g 5%\nProtein 8g\nPotassium 3000mg 8%')
    const user = userEvent.setup()
    render(<App />)
    await openLogger(user)
    await scan(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Juice')
    const flagged = document.querySelector('form.logger-form')?.getAttribute('data-label-check') ?? ''
    expect(flagged).toContain('potassium')
    expect((document.querySelector('details.nutrient-all') as HTMLDetailsElement).open).toBe(true)
    expect((screen.getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: /Looks right: Potassium/ }))
    expect((screen.getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('label scan with a plate', () => {
  it('adds the scanned food to the plate through the same form, and Log saves it with its micronutrients', async () => {
    reading(LABEL)
    const user = userEvent.setup()
    render(<App />)
    await openLogger(user)
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /^Add Protein bar to plate/ }))
    expect(screen.getByRole('region', { name: 'Plate' })).toBeTruthy()
    await scan(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Yogurt drink')
    const add = await screen.findByRole('button', { name: 'Add to plate' })
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
    await user.click(add)
    const tray = await screen.findByRole('region', { name: 'Plate' })
    expect(tray.textContent).toContain('2 foods')
    await user.click(within(tray).getByRole('button', { name: 'Log 2 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const saved = m.saveEntries.mock.calls[0][0] as (DiaryEntry & Record<string, unknown>)[]
    expect(saved.map((item) => item.name)).toEqual(['Protein bar', 'Yogurt drink'])
    expect(saved[1]).toMatchObject({ calories: 120, potassium: 400, calcium: 300, iron: 1, vitaminD: 2.5, transFat: 0.5 })
    expect('potassium' in saved[0]).toBe(false)
  })

  it('keeps flag gating when adding to the plate', async () => {
    reading('Nutrition Facts\nServing size 1 cup (240g)\nCalories 120\nTotal Fat 4g 5%\nTotal Carbohydrate 15g 5%\nProtein 8g\nPotassium 3000mg 8%')
    const user = userEvent.setup()
    render(<App />)
    await openLogger(user)
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /^Add Protein bar to plate/ }))
    await scan(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Juice')
    expect((await screen.findByRole('button', { name: 'Add to plate' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: /Looks right: Potassium/ }))
    expect((screen.getByRole('button', { name: 'Add to plate' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
