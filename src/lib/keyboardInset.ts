import { useEffect } from 'react'

/** Pixels at the bottom of the layout viewport that the on-screen keyboard covers. Never negative. */
export const keyboardInset = (innerHeight: number, viewportHeight: number, viewportOffsetTop: number): number => {
  const inset = innerHeight - viewportHeight - viewportOffsetTop
  return Number.isFinite(inset) ? Math.max(0, Math.round(inset)) : 0
}

/**
 * Keeps `--kb-inset` on the root element equal to the height the keyboard covers, so a bar pinned to the bottom of a sheet can sit above it
 * (phones keep the layout viewport the same size when the keyboard opens). Does nothing where `visualViewport` does not exist.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!viewport) return undefined
    const root = document.documentElement
    const update = () => root.style.setProperty('--kb-inset', `${keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop)}px`)
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--kb-inset')
    }
  }, [])
}
