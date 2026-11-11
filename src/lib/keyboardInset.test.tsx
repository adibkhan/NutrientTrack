import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyboardInset, useKeyboardInset } from './keyboardInset'

function Probe() { useKeyboardInset(); return null }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.style.removeProperty('--kb-inset'); Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined }) })

describe('keyboardInset', () => {
  it.each([[800, 800, 0, 0], [800, 500, 0, 300], [800, 500, 40, 260], [800, 800, 30, 0], [800, 900, 0, 0], [800, Number.NaN, 0, 0]])('inner %i, viewport %s, top %i gives %s', (inner, height, top, expected) => {
    expect(keyboardInset(inner, height, top)).toBe(expected)
  })
})

describe('useKeyboardInset', () => {
  it('does nothing without visualViewport', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    render(<Probe />)
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('')
  })

  it('sets the variable, follows resize and scroll, and cleans up', () => {
    const listeners: Record<string, () => void> = {}
    const viewport = { height: 500, offsetTop: 0, addEventListener: (type: string, fn: () => void) => { listeners[type] = fn }, removeEventListener: vi.fn((type: string) => { delete listeners[type] }) }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const { unmount } = render(<Probe />)
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('300px')
    viewport.height = 800
    listeners.resize()
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('0px')
    viewport.height = 600; viewport.offsetTop = 50
    listeners.scroll()
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('150px')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('')
    expect(viewport.removeEventListener).toHaveBeenCalledTimes(2)
  })
})
