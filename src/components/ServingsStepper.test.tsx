import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServingsStepper } from './ServingsStepper'

afterEach(cleanup)

const less = () => screen.getByRole('button', { name: 'Half a serving less' }) as HTMLButtonElement
const more = () => screen.getByRole('button', { name: 'Half a serving more' }) as HTMLButtonElement

describe('ServingsStepper', () => {
  it('shows the value in a Servings box', () => {
    render(<ServingsStepper value="2" onChange={() => undefined} />)
    expect((screen.getByLabelText('Servings') as HTMLInputElement).value).toBe('2')
  })

  it('adds half a serving with the plus button', async () => {
    const onChange = vi.fn()
    render(<ServingsStepper value="1" onChange={onChange} />)
    await userEvent.setup().click(more())
    expect(onChange).toHaveBeenCalledWith('1.5')
  })

  it('removes half a serving with the minus button', async () => {
    const onChange = vi.fn()
    render(<ServingsStepper value="2" onChange={onChange} />)
    await userEvent.setup().click(less())
    expect(onChange).toHaveBeenCalledWith('1.5')
  })

  it('disables minus at exactly half a serving', () => {
    render(<ServingsStepper value="0.5" onChange={() => undefined} />)
    expect(less().disabled).toBe(true)
  })

  it('keeps minus enabled at one serving', () => {
    render(<ServingsStepper value="1" onChange={() => undefined} />)
    expect(less().disabled).toBe(false)
  })

  it.each([['empty', ''], ['spaces', '  '], ['zero', '0'], ['negative', '-1']])('disables minus when the box is %s', (_label, value) => {
    render(<ServingsStepper value={value} onChange={() => undefined} />)
    expect(less().disabled).toBe(true)
  })

  it('starts plus from zero when the box is empty', async () => {
    const onChange = vi.fn()
    render(<ServingsStepper value="" onChange={onChange} />)
    await userEvent.setup().click(more())
    expect(onChange).toHaveBeenCalledWith('0.5')
  })

  it('starts plus from zero when the value is invalid', async () => {
    const onChange = vi.fn()
    render(<ServingsStepper value="-3" onChange={onChange} />)
    await userEvent.setup().click(more())
    expect(onChange).toHaveBeenCalledWith('0.5')
  })

  it('reports typed text as typed', () => {
    const onChange = vi.fn()
    render(<ServingsStepper value="1" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Servings'), { target: { value: '2.5' } })
    expect(onChange).toHaveBeenCalledWith('2.5')
  })

  it('shows the hint when given', () => {
    render(<ServingsStepper value="1" hint="One serving: 1 cup" onChange={() => undefined} />)
    expect(screen.getByText('One serving: 1 cup')).toBeTruthy()
  })

  it('shows no hint when none is given', () => {
    const { container } = render(<ServingsStepper value="1" onChange={() => undefined} />)
    expect(container.querySelector('.field-hint')).toBeNull()
  })
})
