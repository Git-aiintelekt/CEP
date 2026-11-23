/**
 * The Content step's Link Tracking row: its title and Edit, which opens Settings → UTM Tracking (the workspace's
 * settings, which decide how a campaign's links go out) in a new tab. Shown to anyone with Sending Engines · Edit.
 */
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

export function LinkTrackingRow() {
  const { can } = useAuth()
  return (
    <div data-link-tracking className="flex items-center justify-between gap-3 px-5 py-4">
      <h2 className="text-card-title font-semibold text-ink-900">Link Tracking</h2>
      {can('provider.edit') && (
        <Link to="/settings/utm-tracking" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
          Edit <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      )}
    </div>
  )
}
