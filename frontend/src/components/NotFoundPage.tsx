import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-brand-800">404</p>
      <h1 className="mt-1 font-display text-page-title font-semibold text-ink-900">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-800 hover:underline">
        Back to Home
      </Link>
    </div>
  )
}
