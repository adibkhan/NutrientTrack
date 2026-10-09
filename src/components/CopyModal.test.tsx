import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from '../types'
import { CopyModal } from './CopyModal'

afterEach(cleanup)

const stamp = '2026-01-01T00:00:00.000Z'
const entry = { id: 'e-1', date: '2026-06-10', meal: 'dinner', time: '18:30', name: 'Stew', calories: 600, protein: 30, carbs: 60, fat: 20, createdAt: stamp, updatedAt: stamp } as DiaryEntry

function setup(props: Partial<ComponentProps<typeof CopyModal>> = {}) {
  const onCopyEntry = vi.fn(() => Promise.resolve())
  const onCopyDay = vi.fn(() => Promise.resolve())
  const onClose = vi.fn()
  render(<CopyModal sourceDate="2026-06-10" defaultDate="2026-06-11" dayCount={2} onClose={onClose} onCopyEntry={onCopyEntry} onCopyDay={onCopyDay} {...props} />)
  return { onCopyEntry, onCopyDay, onClose }
}
const date = () => screen.getByLabelText('Copy to date') as HTMLInputElement

describe('CopyModal for one entry', () => {
  it('prefills_date_meal_and_time_from_the_entry_and_default', () => {
    setup({ entry })
    expect(date().value).toBe('2026-06-11')
    expect((screen.getByLabelText('Meal') as HTMLSelectElement).value).toBe('dinner')
    expect((screen.getByLabelText(/^Time/) as HTMLInputElement).value).toBe('18:30')
    expect(screen.getByText('Copy Stew')).toBeTruthy()
  })

  it('passes_the_chosen_meal_date_and_time', async () => {
    const { onCopyEntry, onCopyDay } = setup({ entry })
    fireEvent.change(date(), { target: { value: '2026-07-01' } })
    await userEvent.selectOptions(screen.getByLabelText('Meal'), 'breakfast')
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '07:15' } })
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopyEntry).toHaveBeenCalledWith(entry, 'breakfast', '2026-07-01', '07:15')
    expect(onCopyDay).not.toHaveBeenCalled()
  })

  it('allows_copying_an_entry_to_the_same_date', async () => {
    const { onCopyEntry } = setup({ entry })
    fireEvent.change(date(), { target: { value: '2026-06-10' } })
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopyEntry).toHaveBeenCalledTimes(1)
  })

  it('asks_for_a_date_when_it_is_cleared', async () => {
    const { onCopyEntry } = setup({ entry })
    fireEvent.change(date(), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(screen.getByRole('alert').textContent).toContain('Choose a date.')
    expect(onCopyEntry).not.toHaveBeenCalled()
  })

  it('cancel_closes_without_copying', async () => {
    const { onClose, onCopyEntry } = setup({ entry })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onCopyEntry).not.toHaveBeenCalled()
  })

  it('blocks_a_double_submit_while_saving', async () => {
    let release: () => void = () => undefined
    const onCopyEntry = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    setup({ entry, onCopyEntry })
    const form = date().closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    await screen.findByRole('button', { name: /Copying/ })
    expect(onCopyEntry).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy())
  })
})

describe('CopyModal for a whole day', () => {
  it('hides_meal_and_time_and_states_the_count', () => {
    setup({ dayCount: 3 })
    expect(screen.queryByLabelText('Meal')).toBeNull()
    expect(screen.getByText(/3 eaten foods will be copied/)).toBeTruthy()
  })

  it('uses_the_singular_for_one_food', () => {
    setup({ dayCount: 1 })
    expect(screen.getByText(/1 eaten food will be copied/)).toBeTruthy()
  })

  it('rejects_the_same_day', async () => {
    const { onCopyDay } = setup()
    fireEvent.change(date(), { target: { value: '2026-06-10' } })
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(screen.getByRole('alert').textContent).toContain('Choose a different day')
    expect(onCopyDay).not.toHaveBeenCalled()
  })

  it('copies_to_the_chosen_date', async () => {
    const { onCopyDay } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopyDay).toHaveBeenCalledWith('2026-06-11')
  })

  it('disables_Copy_when_no_eaten_foods', () => {
    setup({ dayCount: 0 })
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
