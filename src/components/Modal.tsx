import type React from 'react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Icon } from './Icon'

interface ModalProps {
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
  closeOnBackdrop?: boolean
}

export function Modal({ title, eyebrow, children, onClose, closeOnBackdrop = true }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Captured during render, before any child autoFocus runs, so it is the element that opened the dialog.
  const [trigger] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  // On phones the dialog is a bottom sheet: dragging the handle or header down past a threshold closes it.
  const drag = useRef<{ startY: number; startTime: number; dy: number } | null>(null)
  const [sheetOffset, setSheetOffset] = useState(0)
  const [settling, setSettling] = useState(false)
  const onDragStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 1) return
    drag.current = { startY: event.touches[0].clientY, startTime: Date.now(), dy: 0 }
    setSettling(false)
  }
  const onDragMove = (event: React.TouchEvent) => {
    if (!drag.current) return
    const dy = Math.max(0, event.touches[0].clientY - drag.current.startY)
    drag.current.dy = dy
    setSheetOffset(dy)
  }
  const onDragEnd = () => {
    const current = drag.current
    drag.current = null
    if (!current) return
    const velocity = current.dy / Math.max(1, Date.now() - current.startTime)
    if (current.dy > 110 || (current.dy > 40 && velocity > 0.5)) {
      setSheetOffset(window.innerHeight)
      setSettling(true)
      window.setTimeout(() => onCloseRef.current(), 160)
      return
    }
    setSettling(true)
    setSheetOffset(0)
  }

  useEffect(() => {
    if (!modalRef.current?.contains(document.activeElement)) closeButtonRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      trigger?.focus()
    }
  }, [trigger])

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => closeOnBackdrop && event.target === event.currentTarget && onClose()}>
      <section ref={modalRef} aria-modal="true" className={`modal ${settling ? 'is-settling' : ''}`} role="dialog" aria-labelledby="modal-title" onKeyDown={trapFocus} style={sheetOffset ? { transform: `translateY(${sheetOffset}px)` } : undefined}>
        <div className="sheet-grip" aria-hidden="true" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd} onTouchCancel={onDragEnd}><span /></div>
        <div className="modal-header" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd} onTouchCancel={onDragEnd}>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button quiet" type="button" aria-label="Close dialog" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
