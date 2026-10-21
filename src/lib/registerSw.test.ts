import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerServiceWorkerWhenIdle } from './registerSw'

const register = vi.fn(() => Promise.resolve())
beforeEach(() => {
  register.mockClear()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
})
afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('registerServiceWorkerWhenIdle', () => {
  it('waits_for_the_load_event_and_an_idle_moment', () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    delete (window as unknown as Record<string, unknown>).requestIdleCallback
    registerServiceWorkerWhenIdle()
    vi.advanceTimersByTime(5000)
    expect(register).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    expect(register).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(register).toHaveBeenCalledWith('./sw.js')
  })

  it('uses_requestIdleCallback_when_present_and_can_be_cancelled', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    const callbacks: Array<() => void> = []
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: (cb: () => void) => callbacks.push(cb) })
    Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: () => undefined })
    const cancel = registerServiceWorkerWhenIdle()
    expect(register).not.toHaveBeenCalled()
    cancel()
    callbacks[0]()
    expect(register).not.toHaveBeenCalled()
    registerServiceWorkerWhenIdle()
    callbacks[1]()
    expect(register).toHaveBeenCalledTimes(1)
    delete (window as unknown as Record<string, unknown>).requestIdleCallback
    delete (window as unknown as Record<string, unknown>).cancelIdleCallback
  })
})
