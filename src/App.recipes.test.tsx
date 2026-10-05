// Recipes: built from saved foods and custom lines, saved as a food with per-serving macros and an ingredients snapshot.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food } from './types'

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

const oats: Food = { id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp }
const milk: Food = { id: 'f2', name: 'Milk', serving: '1 glass', calories: 100, protein: 8, carbs: 12, fat: 2.5, createdAt: stamp, updatedAt: stamp }
const stew = (over: Record<string, unknown> = {}): Food => ({
  id: 'r1', name: 'Bean stew', serving: '1 serving', calories: 250, protein: 15, carbs: 30, fat: 5,
  ingredients: [{ name: 'Beans', calories: 400, protein: 24, carbs: 48, fat: 8 }, { name: 'Stock', calories: 100, protein: 6, carbs: 12, fat: 2, quantity: 1, foodId: 'f9' }],
  recipeServings: 2, createdAt: stamp, updatedAt: stamp, ...over,
}) as Food

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

type User = ReturnType<typeof userEvent.setup>

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Foods'))
  return user
}

async function openNewRecipe(user: User) {
  await user.click(await screen.findByRole('button', { name: 'New recipe' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('heading', { name: 'Create a recipe' })).toBeTruthy()
  return dialog
}

const savedFoodArg = () => {
  expect(m.saveFood).toHaveBeenCalledTimes(1)
  return m.saveFood.mock.calls[0][0] as Food & Record<string, unknown>
}
const preview = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll('.nutrition-preview strong')).map((node) => node.textContent)
const create = (user: User, dialog: HTMLElement) => user.click(within(dialog).getByRole('button', { name: 'Create recipe' }))
const alertText = async (dialog: HTMLElement) => (await within(dialog).findByRole('alert')).textContent

async function addSavedFood(user: User, dialog: HTMLElement, id: string, quantity: string) {
  await user.selectOptions(within(dialog).getByLabelText('Add a saved food'), id)
  const box = within(dialog).getByLabelText('Servings')
  await user.clear(box)
  await user.type(box, quantity)
  await user.click(within(dialog).getByRole('button', { name: 'Add' }))
}

async function addCustom(user: User, dialog: HTMLElement, index: number, values: { name?: string; calories?: string; protein?: string; carbs?: string; fat?: string }) {
  await user.click(within(dialog).getByRole('button', { name: 'Add a custom ingredient' }))
  for (const [key, value] of Object.entries(values)) await user.type(within(dialog).getByLabelText(`Ingredient ${index} ${key}`), value)
}

describe('New recipe dialog validation', () => {
  it('opens from the Foods view with the default of one serving and no ingredients', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    expect((within(dialog).getByLabelText('Servings made') as HTMLInputElement).value).toBe('1')
    expect(within(dialog).getByText(/No ingredients yet/)).toBeTruthy()
    expect(preview(dialog)).toEqual(['0kcal', '0g', '0g', '0g'])
  })

  it('requires a name', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await addCustom(user, dialog, 1, { name: 'Beans', calories: '100' })
    await create(user, dialog)
    expect(await alertText(dialog)).toBe('Give this recipe a name.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it.each([['0'], ['']])('requires servings above zero (servings: "%s")', async (servings) => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Stew')
    await addCustom(user, dialog, 1, { name: 'Beans', calories: '100' })
    const box = within(dialog).getByLabelText('Servings made')
    await user.clear(box)
    if (servings) await user.type(box, servings)
    await create(user, dialog)
    expect(await alertText(dialog)).toBe('Enter how many servings the recipe makes, more than zero.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('requires at least one ingredient', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Stew')
    await create(user, dialog)
    expect(await alertText(dialog)).toBe('Add at least one ingredient.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('requires every ingredient to have a name, even when another one is named', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Stew')
    await addCustom(user, dialog, 1, { name: 'Beans', calories: '100' })
    await addCustom(user, dialog, 2, { calories: '50' })
    await create(user, dialog)
    expect(await alertText(dialog)).toBe('Give every ingredient a name.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only ingredient name as missing', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Stew')
    await addCustom(user, dialog, 1, { name: '   ' })
    await create(user, dialog)
    expect(await alertText(dialog)).toBe('Give every ingredient a name.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only recipe name as missing', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), '   ')
    await addCustom(user, dialog, 1, { name: 'Beans' })
    await create(user, dialog)
    expect(await alertText(dialog)).toBe('Give this recipe a name.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })
})

describe('building ingredient lines', () => {
  it('adds a saved food at quantity 2 as a line holding the food values times 2', async () => {
    m.getFoods.mockResolvedValue([oats, milk])
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await addSavedFood(user, dialog, 'f1', '2')

    expect((within(dialog).getByLabelText('Ingredient 1 name') as HTMLInputElement).value).toBe('Oats')
    expect((within(dialog).getByLabelText('Ingredient 1 calories') as HTMLInputElement).value).toBe('300')
    expect((within(dialog).getByLabelText('Ingredient 1 protein') as HTMLInputElement).value).toBe('10')
    expect((within(dialog).getByLabelText('Ingredient 1 carbs') as HTMLInputElement).value).toBe('54')
    expect((within(dialog).getByLabelText('Ingredient 1 fat') as HTMLInputElement).value).toBe('6')
  })

  it('resets the picker and quantity after adding', async () => {
    m.getFoods.mockResolvedValue([oats])
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await addSavedFood(user, dialog, 'f1', '2')
    expect((within(dialog).getByLabelText('Add a saved food') as HTMLSelectElement).value).toBe('')
    expect((within(dialog).getByLabelText('Servings') as HTMLInputElement).value).toBe('1')
    expect((within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds a custom ingredient line that can be filled in and removed', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await addCustom(user, dialog, 1, { name: 'Honey', calories: '60', carbs: '17' })
    expect((within(dialog).getByLabelText('Ingredient 1 name') as HTMLInputElement).value).toBe('Honey')
    expect(preview(dialog)).toEqual(['60kcal', '0g', '17g', '0g'])
    await user.click(within(dialog).getByRole('button', { name: 'Remove ingredient 1' }))
    expect(within(dialog).queryByLabelText('Ingredient 1 name')).toBeNull()
    expect(preview(dialog)).toEqual(['0kcal', '0g', '0g', '0g'])
  })

  it('divides the per-serving preview by the servings made', async () => {
    m.getFoods.mockResolvedValue([oats])
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await addSavedFood(user, dialog, 'f1', '2')
    await addCustom(user, dialog, 2, { name: 'Honey', calories: '60', carbs: '17' })
    expect(preview(dialog)).toEqual(['360kcal', '10g', '71g', '6g'])
    const servings = within(dialog).getByLabelText('Servings made')
    await user.clear(servings)
    await user.type(servings, '4')
    expect(preview(dialog)).toEqual(['90kcal', '2.5g', '17.8g', '1.5g'])
  })
})

describe('Create recipe', () => {
  it('saves a food with the name, "1 serving", per-serving macros, the ingredients snapshot and recipeServings', async () => {
    m.getFoods.mockResolvedValue([oats])
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), '  Sweet oats  ')
    await addSavedFood(user, dialog, 'f1', '2')
    await addCustom(user, dialog, 2, { name: 'Honey', calories: '60', carbs: '17' })
    const servings = within(dialog).getByLabelText('Servings made')
    await user.clear(servings)
    await user.type(servings, '4')
    await create(user, dialog)

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const saved = savedFoodArg()
    expect(saved).toMatchObject({ name: 'Sweet oats', serving: '1 serving', calories: 90, protein: 2.5, carbs: 17.8, fat: 1.5, recipeServings: 4 })
    expect(saved.id).toBeTruthy()
    expect(saved.createdAt).toBe(saved.updatedAt)
    expect(saved.ingredients).toEqual([
      { name: 'Oats', calories: 300, protein: 10, carbs: 54, fat: 6, quantity: 2, foodId: 'f1' },
      { name: 'Honey', calories: 60, protein: 0, carbs: 17, fat: 0 },
    ])
    expect(saved.ingredients?.[1]).not.toHaveProperty('quantity')
    expect(saved.ingredients?.[1]).not.toHaveProperty('foodId')
  })

  it('closes the dialog after saving', async () => {
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Toast')
    await addCustom(user, dialog, 1, { name: 'Bread', calories: '80' })
    await create(user, dialog)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the dialog open and reports an error when the save fails', async () => {
    m.saveFood.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Toast')
    await addCustom(user, dialog, 1, { name: 'Bread', calories: '80' })
    await create(user, dialog)
    await waitFor(() => expect(document.querySelector('.toast.error')?.textContent).toContain('That recipe could not be saved'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('editing and logging a recipe', () => {
  it('shows a Recipe tag on a recipe row but not on a plain food', async () => {
    m.getFoods.mockResolvedValue([oats, stew()])
    await renderApp()
    const stewRow = (await screen.findByRole('button', { name: 'Edit Bean stew' })).closest('.library-row') as HTMLElement
    const oatsRow = screen.getByRole('button', { name: 'Edit Oats' }).closest('.library-row') as HTMLElement
    expect(within(stewRow).getByText('Recipe')).toBeTruthy()
    expect(within(oatsRow).queryByText('Recipe')).toBeNull()
  })

  it('opens the recipe dialog, not the food dialog, when a recipe is edited', async () => {
    m.getFoods.mockResolvedValue([stew()])
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Edit Bean stew' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Update recipe' })).toBeTruthy()
    expect(within(dialog).queryByLabelText('Food name')).toBeNull()
    expect((within(dialog).getByLabelText('Recipe name') as HTMLInputElement).value).toBe('Bean stew')
    expect((within(dialog).getByLabelText('Servings made') as HTMLInputElement).value).toBe('2')
    expect((within(dialog).getByLabelText('Ingredient 1 name') as HTMLInputElement).value).toBe('Beans')
    expect((within(dialog).getByLabelText('Ingredient 2 name') as HTMLInputElement).value).toBe('Stock')
    expect(preview(dialog)).toEqual(['250kcal', '15g', '30g', '5g'])
  })

  it('keeps unknown fields, the id, createdAt and favorite on save, and recomputes per-serving macros', async () => {
    m.getFoods.mockResolvedValue([stew({ favorite: true, brand: 'Homemade', fiber: 9 })])
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Edit Bean stew' }))
    const dialog = await screen.findByRole('dialog')
    const servings = within(dialog).getByLabelText('Servings made')
    await user.clear(servings)
    await user.type(servings, '5')
    await user.click(within(dialog).getByRole('button', { name: 'Save recipe' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const saved = savedFoodArg()
    expect(saved).toMatchObject({ id: 'r1', createdAt: stamp, brand: 'Homemade', fiber: 9, favorite: true, recipeServings: 5, calories: 100, protein: 6, carbs: 12, fat: 2 })
    expect(saved.updatedAt).not.toBe(stamp)
    expect(saved.ingredients).toHaveLength(2)
    expect(saved.ingredients?.[1]).toMatchObject({ quantity: 1, foodId: 'f9' })
  })

  it('does not offer the recipe itself or other recipes in its own picker', async () => {
    m.getFoods.mockResolvedValue([oats, stew(), stew({ id: 'r2', name: 'Chili' })])
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Edit Bean stew' }))
    const dialog = await screen.findByRole('dialog')
    const options = Array.from((within(dialog).getByLabelText('Add a saved food') as HTMLSelectElement).options).map((option) => option.textContent)
    expect(options).toEqual(['Choose…', 'Oats · 1 cup'])
  })

  it('does not offer existing recipes when a new recipe is created', async () => {
    m.getFoods.mockResolvedValue([oats, stew()])
    const user = await renderApp()
    const dialog = await openNewRecipe(user)
    const options = Array.from((within(dialog).getByLabelText('Add a saved food') as HTMLSelectElement).options).map((option) => option.textContent)
    expect(options).toEqual(['Choose…', 'Oats · 1 cup'])
  })

  it('logs a recipe from Foods using its per-serving macros', async () => {
    m.getFoods.mockResolvedValue([stew()])
    const user = await renderApp()
    const row = (await screen.findByRole('button', { name: 'Edit Bean stew' })).closest('.library-row') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^Log$/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0] as DiaryEntry).toMatchObject({ name: 'Bean stew', foodId: 'r1', calories: 250, protein: 15, carbs: 30, fat: 5 })
  })
})
