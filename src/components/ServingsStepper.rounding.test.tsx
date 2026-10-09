// Half-serving steps must not leak floating point noise into the stored amount.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ServingsStepper } from './ServingsStepper'

afterEach(cleanup)

function Harness({ start }: { start: string }) {
  const [value, setValue] = useState(start)
  return <ServingsStepper value={value} onChange={setValue} />
}
const input = () => screen.getByLabelText('Servings') as HTMLInputElement

describe('ServingsStepper rounding', () => {
  it('adds_half_to_0.1_and_shows_0.6', async () => {
    render(<Harness start="0.1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect(input().value).toBe('0.6')
  })

  it('adds_half_to_0.07_without_floating_point_noise', async () => {
    // 0.07 + 0.5 is 0.5700000000000001 in plain floating point.
    render(<Harness start="0.07" />)
    await userEvent.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect(input().value).toBe('0.57')
  })

  it('subtracts_half_from_1.1_and_shows_0.6', async () => {
    render(<Harness start="1.1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Half a serving less' }))
    expect(input().value).toBe('0.6')
  })

  it('steps_up_from_an_empty_field_to_0.5', async () => {
    render(<Harness start="" />)
    await userEvent.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect(input().value).toBe('0.5')
  })

  it('disables_the_minus_button_at_exactly_half', () => {
    render(<Harness start="0.5" />)
    expect((screen.getByRole('button', { name: 'Half a serving less' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
