import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last line of defence: a render error in any screen shows this instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-sm font-semibold text-danger-text">Screen failed to render</p>
        <h1 className="mt-1 font-display text-page-title font-semibold text-ink-900">This screen could not be shown</h1>
        <p className="mt-2 text-sm text-ink-800">{this.state.error.message}</p>
        <p className="mt-1 text-sm text-ink-800">Reload the page. If it fails again, go back to the overview.</p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-10 items-center rounded-control-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-800">
            Reload
          </button>
          <a href="/" className="inline-flex h-10 items-center rounded-control-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-800">
            Go to Home
          </a>
        </div>
      </div>
    )
  }
}
