import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

afterEach(cleanup)

const closeButton = () => screen.getByRole('button', { name: 'Close dialog' })
const backdrop = () => screen.getByRole('dialog').parentElement as HTMLElement

describe('Modal focus', () => {
  it('keeps focus on an autoFocus child instead of the Close button', () => {
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="name" autoFocus />
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('name'))
  })

  it('focuses the Close button when no child takes focus', () => {
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="name" />
      </Modal>,
    )
    expect(document.activeElement).toBe(closeButton())
  })

  it('returns focus to the opener on unmount', () => {
    const { rerender } = renderWithOpener(false)
    const opener = screen.getByRole('button', { name: 'open' })
    opener.focus()
    rerender(<Harness open autoFocusChild={false} />)
    expect(document.activeElement).toBe(closeButton())
    rerender(<Harness open={false} autoFocusChild={false} />)
    expect(document.activeElement).toBe(opener)
  })

  it('returns focus to the opener on unmount even when the dialog had an autoFocus input', () => {
    const { rerender } = renderWithOpener(false)
    const opener = screen.getByRole('button', { name: 'open' })
    opener.focus()
    rerender(<Harness open autoFocusChild />)
    expect(document.activeElement).toBe(screen.getByLabelText('name'))
    rerender(<Harness open={false} autoFocusChild />)
    expect(document.activeElement).toBe(opener)
  })
})

function Harness({ open, autoFocusChild }: { open: boolean; autoFocusChild: boolean }) {
  return (
    <>
      <button type="button">open</button>
      {open && (
        <Modal title="T" onClose={() => {}}>
          <input aria-label="name" autoFocus={autoFocusChild} />
        </Modal>
      )}
    </>
  )
}

function renderWithOpener(open: boolean) {
  return render(<Harness open={open} autoFocusChild={false} />)
}

describe('Modal closing', () => {
  it('closes on backdrop mousedown by default', async () => {
    const onClose = vi.fn()
    render(<Modal title="T" onClose={onClose}>body</Modal>)
    await userEvent.pointer({ keys: '[MouseLeft>]', target: backdrop() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores backdrop mousedown when closeOnBackdrop is false, but Escape still closes', async () => {
    const onClose = vi.fn()
    render(<Modal title="T" onClose={onClose} closeOnBackdrop={false}>body</Modal>)
    await userEvent.pointer({ keys: '[MouseLeft>]', target: backdrop() })
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when clicking inside the dialog', async () => {
    const onClose = vi.fn()
    render(<Modal title="T" onClose={onClose}><p>inside</p></Modal>)
    await userEvent.click(screen.getByText('inside'))
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on inside click when closeOnBackdrop is false', async () => {
    const onClose = vi.fn()
    render(<Modal title="T" onClose={onClose} closeOnBackdrop={false}><p>inside</p></Modal>)
    await userEvent.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Modal Tab trapping', () => {
  function Trap() {
    return (
      <Modal title="T" onClose={() => {}}>
        <input aria-label="first-body" />
        <button type="button">last</button>
      </Modal>
    )
  }

  it('wraps Tab from the last control to the first (Close button)', async () => {
    render(<Trap />)
    screen.getByRole('button', { name: 'last' }).focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(closeButton())
  })

  it('wraps Shift+Tab from the first control (Close button) to the last', async () => {
    render(<Trap />)
    expect(document.activeElement).toBe(closeButton())
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })
})
