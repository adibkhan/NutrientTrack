import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { failed: boolean }

/**
 * The last line of defence: a render error anywhere below (a chunk that failed to load offline, a stored record from another build)
 * shows a small recoverable panel instead of a blank page. Stored data is untouched; reloading starts the app again.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State { return { failed: true } }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Console only: nothing leaves the device.
    console.error('NutrientTrack could not render', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="app-error" role="alert">
        <h1>{"Something didn't load."}</h1>
        <p>Check your connection and reload. Your diary is stored on this device and has not changed.</p>
        <button className="button primary" type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
