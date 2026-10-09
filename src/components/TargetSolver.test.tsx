import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TargetSolver } from './TargetSolver'

afterEach(cleanup)

const options = [
  { key: 'calories', label: 'Calories (kcal)', perUnit: 200 },
  { key: 'protein', label: 'Protein (g)', perUnit: 10 },
]
const input = () => screen.getByLabelText('Target amount') as HTMLInputElement
const button = () => screen.getByRole('button', { name: 'Set amount' }) as HTMLButtonElement
const type = (value: string) => fireEvent.change(input(), { target: { value } })

describe('TargetSolver', () => {
  it('disables_Set_amount_and_shows_the_prompt_when_empty', () => {
    render(<TargetSolver options={options} unit="servings" onApply={vi.fn()} />)
    expect(button().disabled).toBe(true)
    expect(screen.queryByText(/^That is/)).toBeNull()
  })

  it('shows_the_solved_amount_with_its_unit', () => {
    render(<TargetSolver options={options} unit="servings" onApply={vi.fn()} />)
    type('500')
    expect(screen.getByText('That is 2.5 servings.')).toBeTruthy()
    expect(button().disabled).toBe(false)
  })

  it('applies_the_amount_for_the_first_nutrient_by_default', async () => {
    const onApply = vi.fn()
    render(<TargetSolver options={options} unit="servings" onApply={onApply} />)
    type('300')
    await userEvent.click(button())
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(1.5)
  })

  it('re_solves_when_another_nutrient_is_chosen', async () => {
    const onApply = vi.fn()
    render(<TargetSolver options={options} unit="servings" onApply={onApply} />)
    type('30')
    await userEvent.selectOptions(screen.getByLabelText('Log by target nutrient'), 'protein')
    expect(screen.getByText('That is 3 servings.')).toBeTruthy()
    await userEvent.click(button())
    expect(onApply).toHaveBeenCalledWith(3)
  })

  it.each(['0', '-4', ''])('does_not_apply_for_target_%j', async (value) => {
    const onApply = vi.fn()
    render(<TargetSolver options={options} unit="servings" onApply={onApply} />)
    type(value)
    expect(button().disabled).toBe(true)
    await userEvent.click(button())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('treats_non_numeric_text_as_no_target', () => {
    render(<TargetSolver options={options} unit="servings" onApply={vi.fn()} />)
    type('abc') // a number input drops it to ''
    expect(button().disabled).toBe(true)
    expect(document.body.textContent).not.toMatch(/NaN|undefined/)
  })

  it('leaves_out_a_nutrient_the_food_has_none_of', () => {
    render(<TargetSolver options={[{ key: 'fat', label: 'Fat (g)', perUnit: 0 }, ...options]} unit="g" onApply={vi.fn()} />)
    const labels = Array.from((screen.getByLabelText('Log by target nutrient') as HTMLSelectElement).options).map((o) => o.text)
    expect(labels).toEqual(['Calories (kcal)', 'Protein (g)'])
  })

  it('renders_nothing_when_every_nutrient_is_zero', () => {
    const { container } = render(<TargetSolver options={[{ key: 'fat', label: 'Fat (g)', perUnit: 0 }]} unit="g" onApply={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps_the_requested_digits_in_the_hint', () => {
    render(<TargetSolver options={[{ key: 'protein', label: 'Protein (g)', perUnit: 0.3 }]} unit="g" digits={1} onApply={vi.fn()} />)
    type('10')
    expect(screen.getByText('That is 33.3 g.')).toBeTruthy()
  })
})
