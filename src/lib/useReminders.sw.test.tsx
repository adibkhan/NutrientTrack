// useReminders delivery: service worker first, constructor second, marked fired only when something was shown.
// Only Date is faked, so promises and timers keep working.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReminders } from './useReminders'
import { todayISO } from './utils'

const NOW = new Date(2026, 5, 15, 15, 30, 0)
const times = { logFood: '15:20' }
const context = { loggedFoodToday: false, weighedToday: false }
const firedKey = () => `nutrienttrack-reminder-logFood-${todayISO()}`
const recheck = () => document.dispatchEvent(new Event('visibilitychange'))
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

let ctor: ReturnType<typeof vi.fn> & { permission?: string }
const stubCtor = (impl?: () => void) => {
  ctor = vi.fn(function () { impl?.() }) as unknown as typeof ctor
  ctor.permission = 'granted'
  vi.stubGlobal('Notification', ctor)
}
const stubWorker = (getRegistration: () => unknown) =>
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
  localStorage.clear()
})

describe('useReminders delivery', () => {
  it('shows_through_the_service_worker_registration_and_not_the_constructor_when_one_exists', async () => {
    stubCtor()
    const showNotification = vi.fn(() => Promise.resolve())
    stubWorker(() => Promise.resolve({ showNotification }))
    renderHook(() => useReminders(times, context, true))
    await waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1))
    expect(showNotification).toHaveBeenCalledWith('Log your food', expect.objectContaining({ tag: 'nutrienttrack-logFood' }))
    expect(ctor).not.toHaveBeenCalled()
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
  })

  it('uses_the_constructor_when_serviceWorker_is_absent', async () => {
    stubCtor()
    renderHook(() => useReminders(times, context, true))
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1))
    expect(ctor).toHaveBeenCalledWith('Log your food', expect.objectContaining({ tag: 'nutrienttrack-logFood' }))
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
  })

  it('uses_the_constructor_when_there_is_no_registration', async () => {
    stubCtor()
    stubWorker(() => Promise.resolve(undefined))
    renderHook(() => useReminders(times, context, true))
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
  })

  it('falls_back_to_the_constructor_when_the_service_worker_show_throws', async () => {
    stubCtor()
    stubWorker(() => Promise.resolve({ showNotification: vi.fn(() => Promise.reject(new Error('no'))) }))
    renderHook(() => useReminders(times, context, true))
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
  })

  it('does_not_mark_fired_when_both_paths_throw_and_tries_again_at_the_next_check', async () => {
    let broken = true
    stubCtor(() => { if (broken) throw new TypeError('Illegal constructor') })
    stubWorker(() => Promise.reject(new Error('no worker')))
    renderHook(() => useReminders(times, context, true))
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1))
    await settle()
    expect(localStorage.getItem(firedKey())).toBeNull()

    broken = false
    recheck()
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
  })

  it('does_not_start_the_same_kind_twice_while_one_show_is_in_flight', async () => {
    stubCtor()
    let release: (value: unknown) => void = () => undefined
    const showNotification = vi.fn(() => Promise.resolve())
    const pending = new Promise((resolve) => { release = resolve })
    stubWorker(() => pending)
    renderHook(() => useReminders(times, context, true))
    recheck()
    recheck()
    release({ showNotification })
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
    await settle()
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(ctor).not.toHaveBeenCalled()
  })

  it('shows_nothing_a_second_time_once_marked_fired', async () => {
    stubCtor()
    renderHook(() => useReminders(times, context, true))
    await waitFor(() => expect(localStorage.getItem(firedKey())).not.toBeNull())
    recheck()
    await settle()
    expect(ctor).toHaveBeenCalledTimes(1)
  })
})
