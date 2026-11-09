// Review fixes for comma-decimal input: junk text is refused at its own field, never read as blank or zero.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFood } from './catalog/types'
import type { DiaryEntry, Food, Settings } from './types'
import { todayISO } from './lib/utils'
import { RecipeModal } from './components/RecipeModal'
import { ProgramPanel } from './components/ProgramPanel'
import { MeasurementsModal } from './components/MeasurementsModal'
import { RecipeCalculator } from './recipe/RecipeCalculator'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))
const oats: CatalogFood = { id: 'usda-oats', fdcId: 1, name: 'Rolled oats', category: 'Grains', source: 'USDA SR Legacy', per100g: { calories: 200, protein: 10, carbs: 20, fat: 5 } }
vi.mock('./catalog', () => ({
  searchCatalog: vi.fn(async () => [oats]),
  findCatalogFood: vi.fn(async () => oats),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const field = (id: string) => document.getElementById(id) as HTMLInputElement
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } })
let entries: DiaryEntry[] = []
let foods: Food[] = []

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  entries = []
  foods = []
  m.getEntries.mockImplementation(async () => entries.map((item) => ({ ...item })))
  m.getFoods.mockImplementation(async () => foods.map((item) => ({ ...item })))
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'kg' }, preferences: { welcomed: true }, updatedAt: stamp } as unknown as Settings)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.saveSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
  window.history.replaceState(null, '', '/')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks() })

type User = ReturnType<typeof userEvent.setup>
async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
/** The message element tied to a box: its aria-describedby target, with the box marked invalid. */
const messageFor = (id: string): string => {
  const input = field(id)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  const target = document.getElementById(input.getAttribute('aria-describedby') ?? '')
  expect(target?.getAttribute('role')).toBe('alert')
  return target?.textContent ?? ''
}

const savedFood = (over: Partial<Food> = {}): Food => ({ id: 'f1', name: 'Oats', serving: '1 bowl', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp, ...over } as Food)
const stew = { ...savedFood({ id: 'r1', name: 'Stew' }), recipeServings: 2, ingredients: [{ name: 'Beef', calories: 350, protein: 30, carbs: 0, fat: 20 }] } as unknown as Food

describe('RecipeModal refuses text it cannot read', () => {
  const open = (onSave = vi.fn(() => Promise.resolve())) => {
    render(<RecipeModal recipe={stew} foods={[]} onClose={() => undefined} onSave={onSave} />)
    return onSave
  }
  const save = () => fireEvent.click(screen.getByRole('button', { name: /save|update/i }))

  it.each([['calories', '350 kcal'], ['fat', '-5'], ['protein', '1e3'], ['carbs', 'abc']])('refuses ingredient %s %j at its box and saves nothing', (key, text) => {
    const onSave = open()
    const box = screen.getByLabelText(`Ingredient 1 ${key}`) as HTMLInputElement
    fireEvent.change(box, { target: { value: text } })
    save()
    expect(onSave).not.toHaveBeenCalled()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(`Ingredient 1 ${key} must be a number, zero or greater.`)
    expect(document.activeElement).toBe(box)
  })

  it('names both readings for an ambiguous ingredient amount', () => {
    const onSave = open()
    const box = screen.getByLabelText('Ingredient 1 calories') as HTMLInputElement
    fireEvent.change(box, { target: { value: '1,200' } })
    save()
    expect(onSave).not.toHaveBeenCalled()
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^“1,200” could mean 1200 or 1\.2\./)
  })

  it('clears the message when the box is corrected, and then saves a comma decimal', async () => {
    const onSave = open()
    const box = screen.getByLabelText('Ingredient 1 calories') as HTMLInputElement
    fireEvent.change(box, { target: { value: '350 kcal' } })
    save()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(box, { target: { value: '350,5' } })
    expect(box.getAttribute('aria-invalid')).toBeNull()
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((onSave.mock.calls[0] as unknown as [{ ingredients: Array<{ calories: number }> }])[0].ingredients[0].calories).toBe(350.5)
  })

  it('still reads a blank ingredient amount as 0', async () => {
    const onSave = open()
    fireEvent.change(screen.getByLabelText('Ingredient 1 carbs'), { target: { value: '' } })
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((onSave.mock.calls[0] as unknown as [{ ingredients: Array<{ carbs: number }> }])[0].ingredients[0].carbs).toBe(0)
  })

  it('refuses servings made of "4 people"', () => {
    const onSave = open()
    type('recipe-servings', '4 people')
    save()
    expect(onSave).not.toHaveBeenCalled()
    expect(messageFor('recipe-servings')).toBe('Enter how many servings the recipe makes, more than zero.')
  })

  it.each(['1/2', '0', '-1', 'abc', '2,000'])('refuses an added-food quantity of %j and adds nothing', (text) => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<RecipeModal foods={[savedFood()]} onClose={() => undefined} onSave={onSave} />)
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'f1' } })
    type('recipe-quantity', text)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.queryByLabelText('Ingredient 1 calories')).toBeNull()
    expect(field('recipe-quantity').getAttribute('aria-invalid')).toBe('true')
  })

  it('adds a 1,5 quantity as 1.5', () => {
    render(<RecipeModal foods={[savedFood()]} onClose={() => undefined} onSave={() => Promise.resolve()} />)
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'f1' } })
    type('recipe-quantity', '1,5')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((screen.getByLabelText('Ingredient 1 calories') as HTMLInputElement).value).toBe('225')
  })
})

describe('ProgramPanel refuses text it cannot read', () => {
  const open = (program: Record<string, unknown> = { direction: 'maintain', proteinPerWeight: 1.8 }) => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<ProgramPanel program={program as never} unit="kg" expenditure={{ kind: 'insufficient' } as never} trendWeight={80} onSave={onSave} onApplyBudget={() => Promise.resolve()} />)
    return onSave
  }
  const submit = () => fireEvent.submit(field('program-protein').closest('form') as HTMLFormElement)

  it('keeps the stored protein target when "1.8 g" is typed, and says so at the box', () => {
    const onSave = open()
    type('program-protein', '1.8 g')
    submit()
    expect(onSave).not.toHaveBeenCalled()
    expect(messageFor('program-protein')).toBe('Protein target must be a number greater than zero.')
    expect(document.activeElement).toBe(field('program-protein'))
  })

  it('refuses a goal weight of "abc" and 0, at its own box', () => {
    const onSave = open()
    type('program-goal-weight', 'abc')
    submit()
    expect(messageFor('program-goal-weight')).toBe('Goal weight must be a number greater than zero.')
    type('program-goal-weight', '0')
    submit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the ambiguity message at the box and clears it on edit', () => {
    const onSave = open()
    type('program-protein', '1,125')
    submit()
    expect(onSave).not.toHaveBeenCalled()
    expect(messageFor('program-protein')).toMatch(/^“1,125” could mean 1125 or 1\.125\./)
    type('program-protein', '1,8')
    expect(field('program-protein').getAttribute('aria-invalid')).toBeNull()
  })

  it('refuses a missing or junk rate for a losing program', () => {
    const onSave = open({ direction: 'lose', weeklyRate: 0.5 })
    type('program-rate', '0,5 kg')
    submit()
    expect(onSave).not.toHaveBeenCalled()
    expect(messageFor('program-rate')).toBe('Choose a weekly rate greater than zero.')
  })

  it('saves comma decimals', async () => {
    const onSave = open({ direction: 'lose' })
    type('program-rate', '0,5')
    type('program-protein', '1,8')
    submit()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]).toEqual([expect.objectContaining({ weeklyRate: 0.5, proteinPerWeight: 1.8 })])
  })
})

describe('MeasurementsModal field messages', () => {
  it('puts the message on the box, focuses it, and shows one full-width row in the grid', () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<MeasurementsModal defaultDate="2026-01-01" unit="cm" onClose={() => undefined} onSave={onSave} />)
    type('measure-hips', '1,200')
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(messageFor('measure-hips')).toMatch(/^“1,200” could mean/)
    expect(document.activeElement).toBe(field('measure-hips'))
    expect(document.getElementById('measure-hips-error')?.parentElement?.className).toContain('nutrient-grid')
    type('measure-hips', 'abc')
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }))
    expect(messageFor('measure-hips')).toBe('Hips must be a number greater than zero.')
  })
})

describe('entry form messages', () => {
  async function manual(user: User) {
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Food or meal name'), 'Soup')
    return dialog
  }

  it('drops the message and aria-invalid as soon as the box is corrected', async () => {
    const user = await renderApp()
    const dialog = await manual(user)
    type('entry-calories', '1,200')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    expect(messageFor('entry-calories')).toMatch(/could mean 1200/)
    type('entry-calories', '1,2')
    expect(field('entry-calories').getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById('entry-calories-error')).toBeNull()
  })

  it('shows a macro message as one row of the macro grid, linked to the box', async () => {
    const user = await renderApp()
    const dialog = await manual(user)
    type('entry-calories', '200')
    type('entry-carbs', '1,200')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    messageFor('entry-carbs')
    expect(document.getElementById('entry-carbs-error')?.parentElement?.className).toBe('macro-input-grid')
  })

  it('shows a negative on a non-negative box as a negative, not as readings of a refused number', async () => {
    const user = await renderApp()
    const dialog = await manual(user)
    type('entry-calories', '200')
    type('entry-protein', '-2,000')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    expect(await within(dialog).findByText('Macro amounts must be zero or greater.')).toBeTruthy()
    expect(within(dialog).queryByText(/could mean/)).toBeNull()
    expect(m.saveEntry).not.toHaveBeenCalled()
  })
})

describe('saved-food and weight forms', () => {
  it('puts the food form message on the box, with focus, and clears it on edit', async () => {
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(first(/Create (a )?food|New food|Add food/i))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Food name'), 'Oats')
    type('food-calories', '150')
    type('food-fat', '1,125')
    await user.click(within(dialog).getByRole('button', { name: 'Create food' }))
    expect(messageFor('food-fat')).toMatch(/^“1,125” could mean/)
    expect(document.getElementById('food-fat-error')?.parentElement?.className).toBe('macro-input-grid')
    expect(document.activeElement).toBe(field('food-fat'))
    type('food-fat', '1,5')
    expect(field('food-fat').getAttribute('aria-invalid')).toBeNull()
    type('food-calories', '150 kcal')
    await user.click(within(dialog).getByRole('button', { name: 'Create food' }))
    expect(messageFor('food-calories')).toBe('Add a valid calorie amount.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('puts the weight and body fat messages on their boxes', async () => {
    const user = await renderApp()
    await user.click(first('Trends'))
    await user.click(first('Log weight'))
    const dialog = await screen.findByRole('dialog')
    type('weight-value', '1,200')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    expect(messageFor('weight-value')).toMatch(/^“1,200” could mean/)
    expect(document.activeElement).toBe(field('weight-value'))
    type('weight-value', '82,4')
    type('weight-bodyfat', '90')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    expect(messageFor('weight-bodyfat')).toBe('Body fat must be a percentage between 1 and 75.')
    expect(m.saveWeight).not.toHaveBeenCalled()
  })
})

describe('Settings goals grid', () => {
  it('shows protein, carbs and fat messages as one row under the three boxes', async () => {
    const user = await renderApp()
    await user.click(first('Settings'))
    await screen.findByLabelText(/^Calories/)
    type('goal-protein', '1,200')
    type('goal-carbs', 'abc')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    messageFor('goal-protein')
    expect(document.getElementById('goal-protein-error')?.parentElement?.className).toBe('goal-fields')
    expect(document.getElementById('goal-carbs-error')?.parentElement?.className).toBe('goal-fields')
  })
})

describe('grams buttons', () => {
  it('write rounded grams, never float noise', async () => {
    entries = [{ id: 'e-1', date: todayISO(), meal: 'lunch', name: 'Rolled oats', calories: 2.2, protein: 0.1, carbs: 0.2, fat: 0.05, grams: 1.1, catalogId: 'usda-oats', catalogSource: 'USDA SR Legacy', createdAt: stamp, updatedAt: stamp } as DiaryEntry]
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: /^Rolled oats/ }))
    await screen.findByRole('group', { name: 'Quick amounts' })
    await user.click(screen.getByRole('button', { name: '10 g more' }))
    expect(field('entry-grams').value).toBe('11.1')
    await user.click(screen.getByRole('button', { name: '10 g less' }))
    expect(field('entry-grams').value).toBe('1.1')
  })
})

describe('recipe calculator servings', () => {
  const catalog = [{ id: 'usda-rice', fdcId: 2, name: 'Rice, white, cooked', category: 'Test', source: 'USDA SR Legacy', per100g: { calories: 130, protein: 2, carbs: 28, fat: 0 } }] as CatalogFood[]

  it('says "4 people" is not a number and leaves the text alone on blur', async () => {
    window.history.replaceState(null, '', '/recipe-calories/')
    const user = userEvent.setup()
    render(<RecipeCalculator catalog={catalog} />)
    const box = screen.getByLabelText('Servings') as HTMLInputElement
    await user.clear(box)
    await user.type(box, '4 people')
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Servings must be a number, like 4. Using 1 until it is.')
    await user.tab()
    expect(box.value).toBe('4 people')
    await user.clear(box)
    await user.type(box, '4')
    expect(box.getAttribute('aria-invalid')).toBeNull()
  })
})
