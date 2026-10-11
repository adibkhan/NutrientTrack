// Pip's moments: eating what was just logged, getting dizzy or ticklish from pokes, and being patted.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Mascot } from './Mascot'
import type { MascotLine } from '../lib/mascot'

const line: MascotLine = { id: 'count-2', mood: 'happy', text: '2 foods logged today.' }
const pip = () => screen.getByRole('region', { name: 'Pip, your logging buddy' })
const figure = () => pip().querySelector('svg.pip')!

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Mascot moments', () => {
  it('eats_a_fresh_entry_once_then_goes_back_to_its_line', () => {
    const { rerender } = render(<Mascot line={line} fed={{ id: 'e1', name: 'Bananas, raw' }} />)
    expect(figure().classList.contains('pip-react-eating')).toBe(true)
    expect(pip().querySelector('.pip-bite')).not.toBeNull()
    expect(screen.getByRole('status').textContent?.toLowerCase()).toContain('bananas')
    act(() => { vi.advanceTimersByTime(1800) })
    expect(figure().classList.contains('pip-react-eating')).toBe(false)
    expect(screen.getByRole('status').textContent).toBe('2 foods logged today.')
    rerender(<Mascot line={line} fed={{ id: 'e1', name: 'Bananas, raw' }} />)
    expect(figure().classList.contains('pip-react-eating')).toBe(false)
    rerender(<Mascot line={line} fed={{ id: 'e2', name: 'Coffee' }} />)
    expect(figure().classList.contains('pip-react-eating')).toBe(true)
  })

  it('gets_dizzy_after_three_quick_pokes_and_ticklish_after_five', () => {
    render(<Mascot line={line} />)
    const poke = () => { fireEvent.pointerDown(figure()); fireEvent.pointerUp(figure()) }
    poke(); poke()
    expect(figure().classList.contains('pip-react-dizzy')).toBe(false)
    poke()
    expect(figure().classList.contains('pip-react-dizzy')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Whoa. Dizzy.')
    poke(); poke()
    expect(figure().classList.contains('pip-react-giggle')).toBe(true)
    act(() => { vi.advanceTimersByTime(2500) })
    expect(screen.getByRole('status').textContent).toBe('2 foods logged today.')
  })

  it('treats_a_long_press_as_a_pat', () => {
    render(<Mascot line={line} />)
    fireEvent.pointerDown(figure())
    act(() => { vi.advanceTimersByTime(500) })
    expect(figure().classList.contains('pip-react-loved')).toBe(true)
    expect(pip().querySelector('.pip-hearts')).not.toBeNull()
    fireEvent.pointerUp(figure())
    // The release after a pat is not a poke.
    expect(figure().classList.contains('pip-react-loved')).toBe(true)
  })
})
