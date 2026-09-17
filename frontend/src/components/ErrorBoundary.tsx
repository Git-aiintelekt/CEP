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
        <p className="text-sm font-semibold text-red-700">Something went wrong</p>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">This screen could not be shown</h1>
        <p className="mt-2 text-sm text-ink-500">{this.state.error.message}</p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Reload
          </button>
          <a href="/" className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-700 hover:bg-slate-50">
            Go to the overview
          </a>
        </div>
      </div>
    )
  }
}
