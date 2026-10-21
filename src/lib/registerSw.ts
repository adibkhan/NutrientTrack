/** Register the service worker after the page has loaded and the browser is idle, so its install work never competes with first paint. */
export const registerServiceWorkerWhenIdle = () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) return () => undefined
  let cancelled = false
  let idleHandle: number | undefined
  let timer: number | undefined
  const register = () => {
    if (!cancelled) void Promise.resolve(navigator.serviceWorker.register('./sw.js')).catch(() => undefined)
  }
  const whenIdle = () => {
    if (cancelled) return
    if (typeof window.requestIdleCallback === 'function') idleHandle = window.requestIdleCallback(register, { timeout: 4000 })
    else timer = window.setTimeout(register, 1500)
  }
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
  return () => {
    cancelled = true
    window.removeEventListener('load', whenIdle)
    if (idleHandle !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
