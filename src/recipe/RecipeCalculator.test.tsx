// The recipe calorie calculator page: typing ingredients builds the label, servings split it, the embed is copyable.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFood } from '../catalog/types'
import { RecipeCalculator } from './RecipeCalculator'

const food = (id: string, name: string, per100g: CatalogFood['per100g'], portions?: CatalogFood['portions']): CatalogFood => ({ id, fdcId: 1, name, category: 'Test', source: 'USDA SR Legacy', per100g, portions })
const catalog = [
  food('usda-test-1', 'Rice, white, cooked', { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }, [['1 cup', 158]]),
  food('usda-test-3', 'Oil, olive', { calories: 884, protein: 0, carbs: 0, fat: 100 }, [['1 tbsp', 13.5]]),
]

beforeEach(() => { window.history.replaceState(null, '', '/recipe-calories/') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('RecipeCalculator', () => {
  it('shows_the_label_per_serving_as_ingredients_are_typed_and_keeps_them_in_the_address', async () => {
    const user = userEvent.setup()
    render(<RecipeCalculator catalog={catalog} />)
    expect(screen.getByText('Your label appears here as you type.')).toBeTruthy()
    await user.type(screen.getByRole('textbox', { name: /^Ingredients/ }), '2 cups rice{enter}1 tbsp olive oil')
    const label = screen.getByRole('region', { name: 'Nutrition per serving' })
    // (316 g × 1.3 + 13.5 g × 8.84) / 4 servings
    expect(within(label).getByText('Recipe · 4 servings · per serving')).toBeTruthy()
    expect(within(label).getByText('133')).toBeTruthy()
    await user.clear(screen.getByLabelText('Servings'))
    await user.type(screen.getByLabelText('Servings'), '2')
    expect(within(label).getByText('265')).toBeTruthy()
    expect(decodeURIComponent(window.location.hash)).toBe('#i=2+cups+rice\n1+tbsp+olive+oil&s=2')
    expect(screen.getByRole('link', { name: 'Open these ingredients in NutrientTrack' }).getAttribute('href')).toBe('../?text=2%20cups%20rice%2C%201%20tbsp%20olive%20oil')
  })

  it('starts_from_the_address_and_can_drop_a_wrong_match', async () => {
    window.history.replaceState(null, '', '/recipe-calories/#i=1+cup+rice%0A1+tbsp+olive+oil&s=1')
    const user = userEvent.setup()
    render(<RecipeCalculator catalog={catalog} />)
    const list = screen.getByRole('list', { name: 'Matched ingredients' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await user.click(within(list).getByRole('button', { name: 'Remove Oil, olive' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Nutrition per serving' })).getByText('205')).toBeTruthy()
  })

  it('copies_the_embed_code_and_shows_it_when_the_clipboard_is_unavailable', async () => {
    window.history.replaceState(null, '', '/recipe-calories/#i=1+cup+rice')
    const user = userEvent.setup({ writeToClipboard: false })
    // user-event installs its own clipboard stub; swap it for a spy after setup.
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<RecipeCalculator catalog={catalog} />)
    await user.type(screen.getByLabelText(/Recipe name/), 'Plain rice')
    await user.click(screen.getByRole('button', { name: 'Copy label for your blog' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const html = writeText.mock.calls[0][0]
    expect(html).toContain('Plain rice · 1 serving · per serving')
    expect(html).toContain('Powered by <a href="https://nutrienttrack.com/recipe-calories/"')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    await user.click(screen.getByRole('button', { name: 'Copy as text' }))
    const box = await screen.findByLabelText(/Embed code/)
    expect((box as HTMLTextAreaElement).value).toBe(html)
  })

  it('lists_lines_it_could_not_match', async () => {
    window.history.replaceState(null, '', '/recipe-calories/#i=1+cup+rice%0A1+dragon+egg')
    render(<RecipeCalculator catalog={catalog} />)
    expect(screen.getByText(/No match for “1 dragon egg”/)).toBeTruthy()
  })
})
