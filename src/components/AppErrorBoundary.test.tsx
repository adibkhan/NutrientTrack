import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

const Boom = () => { throw new Error('chunk failed') }
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AppErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(<AppErrorBoundary><p>fine</p></AppErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('shows a recoverable panel instead of a blank page, and Reload reloads', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>)
    const panel = screen.getByRole('alert')
    expect(panel.textContent).toContain("Something didn't load.")
    expect(panel.textContent).toContain('Check your connection and reload.')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
