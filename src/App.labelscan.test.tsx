// Scan a nutrition label: the OCR is mocked; the form, review marks, servings and reusable food are real.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
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
const photo = () => new File(['x'], 'label.jpg', { type: 'image/jpeg' })
const reading = (text: string) => vi.mocked(readLabelPhoto).mockResolvedValue({ parsed: parseLabel(text), text, lines: [], rotation: 0, ms: 1 })
const LABEL = 'Nutrition Facts\nServing size 2/3 cup (55g)\nCalories 230\nTotal Fat 8g 10%\nSodium 600mg 7%\nTotal Carbohydrate 37g 13%\nProtein 3g'

const originalCreate = URL.createObjectURL
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.getWaterLogs.mockResolvedValue([])
  m.getMeasurements.mockResolvedValue([])
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => { cleanup(); URL.createObjectURL = originalCreate })


const openLabel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
  const group = await screen.findByRole('group', { name: 'Other ways to log' })
  await user.click(within(group).getByRole('button', { name: 'Scan label' }))
  await user.upload(await screen.findByLabelText('Choose a photo of the label'), photo())
  await user.click(await screen.findByRole('button', { name: /Use these values/ }))
}

describe('Scan label', () => {
  it('fills_the_form_for_review_and_blocks_saving_until_the_flagged_number_is_confirmed', async () => {
    reading(LABEL)
    const user = userEvent.setup()
    render(<App />)
    await openLabel(user)
    const name = (await screen.findByLabelText('Food or meal name')) as HTMLInputElement
    expect(name.value).toBe('')
    expect((screen.getByLabelText(/^Calories/) as HTMLInputElement).value).toBe('230')
    expect((screen.getByLabelText('Servings') as HTMLInputElement).value).toBe('1')
    expect(document.querySelector('form.logger-form')?.getAttribute('data-label-check')).toBe('sodium')
    const note = screen.getByRole('note', { name: 'About the scanned label' })
    expect(note.textContent).toContain('photo read 600 mg')
    expect(screen.getByAltText(/Crop of your label photo/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: /Save as reusable food/ }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: /Looks right: Sodium/ }))
    expect(document.querySelector('form.logger-form')?.getAttribute('data-label-check')).toBeNull()
    expect((screen.getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(false)
    expect(m.saveEntry).not.toHaveBeenCalled()
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('clears_a_flag_when_the_box_is_edited', async () => {
    reading(LABEL)
    const user = userEvent.setup()
    render(<App />)
    await openLabel(user)
    const sodium = (await screen.findByLabelText(/^Sodium/)) as HTMLInputElement
    await user.clear(sodium)
    await user.type(sodium, '610')
    expect(document.querySelector('form.logger-form')?.getAttribute('data-label-check')).toBeNull()
    expect(screen.queryByRole('button', { name: /Looks right: Sodium/ })).toBeNull()
  })

  it('multiplies_by_servings_eaten_and_saves_the_reusable_food_per_serving', async () => {
    reading(LABEL)
    m.saveEntry.mockResolvedValue(undefined as never)
    m.saveFood.mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    render(<App />)
    await openLabel(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Granola')
    await user.click(screen.getByRole('button', { name: /Looks right: Sodium/ }))
    await user.click(screen.getByRole('button', { name: 'Half a serving more' }))
    await user.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect((screen.getByLabelText(/^Calories/) as HTMLInputElement).value).toBe('460')
    expect((screen.getByLabelText(/^Sodium/) as HTMLInputElement).value).toBe('1200')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await vi.waitFor(() => expect(m.saveFood).toHaveBeenCalled())
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ name: 'Granola', calories: 460, servings: 2, sodium: 1200 })
    expect(m.saveFood.mock.calls[0][0]).toMatchObject({ name: 'Granola', calories: 230, carbs: 37, protein: 3, fat: 8, sodium: 600, serving: '2/3 cup (55g)' })
  })

  it('stores_the_labels_own_per_serving_numbers_when_servings_is_2_point_5', async () => {
    reading('Nutrition Facts\nServing size 1 cup (30g)\nCalories 110\nTotal Fat 3.3g 4%\nTotal Carbohydrate 22g 8%\nProtein 3g')
    m.saveEntry.mockResolvedValue(undefined as never)
    m.saveFood.mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    render(<App />)
    await openLabel(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Cereal')
    await user.clear(screen.getByLabelText('Servings'))
    await user.type(screen.getByLabelText('Servings'), '2.5')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await vi.waitFor(() => expect(m.saveFood).toHaveBeenCalled())
    expect(m.saveFood.mock.calls[0][0]).toMatchObject({ calories: 110, fat: 3.3, carbs: 22, protein: 3 })
  })

  it('keeps_an_unread_macro_blank_and_blocks_saving_until_it_is_typed', async () => {
    reading('Nutrition Facts\nServing size 1 cup (30g)\nCalories 110\nTotal Fat 2g 3%\nTotal Carbohydrate 22g 8%\nSodium 100mg 4%')
    const user = userEvent.setup()
    render(<App />)
    await openLabel(user)
    await user.type(await screen.findByLabelText('Food or meal name'), 'Cereal')
    expect((screen.getByLabelText(/^Protein/) as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Add protein, carbs and fat.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect((screen.getByLabelText(/^Protein/) as HTMLInputElement).value).toBe('')
  })

  it('asks_for_the_grams_eaten_on_a_per_100_g_label', async () => {
    reading('Nutrition per 100 g\nEnergy 1046 kJ / 250 kcal\nFat 12 g\nCarbohydrate 30 g\nProtein 6 g')
    const user = userEvent.setup()
    render(<App />)
    await openLabel(user)
    expect(screen.queryByLabelText('Servings')).toBeNull()
    expect((screen.getByLabelText(/^Calories/) as HTMLInputElement).value).toBe('')
    const eaten = screen.getByLabelText(/Grams you ate/) as HTMLInputElement
    expect(eaten.value).toBe('')
    await user.type(eaten, '150')
    expect((screen.getByLabelText(/^Calories/) as HTMLInputElement).value).toBe('375')
  })

  it('is_also_offered_inside_the_manual_form_and_returns_there_on_back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
    await user.click(await screen.findByRole('button', { name: 'Manual quick add' }))
    await user.click(await screen.findByRole('button', { name: 'Fill from a label photo' }))
    expect(await screen.findByText('Scan a nutrition label')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Food or meal name')).toBeTruthy()
  })

  it('shows_the_could_not_read_message_and_saves_nothing_when_there_are_no_calories', async () => {
    reading('smudge')
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
    await user.click(await screen.findByRole('button', { name: 'Scan label' }))
    await user.upload(await screen.findByLabelText('Take a photo of the label'), photo())
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't read this label")
    expect(m.saveEntry).not.toHaveBeenCalled()
  })
})
