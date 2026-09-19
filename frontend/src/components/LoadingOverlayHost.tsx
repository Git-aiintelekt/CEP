import { useSyncExternalStore } from 'react'

import { loadingOverlay } from '@/lib/loadingOverlay'

import { AuthLoading } from './AuthLoading'

/** Rendered above the router so the loader survives the navigation it is covering. */
export function LoadingOverlayHost() {
  const { label, exiting } = useSyncExternalStore(loadingOverlay.subscribe, loadingOverlay.snapshot, loadingOverlay.snapshot)
  if (label === null) return null
  return (
    <div className={`transition-opacity duration-600 ease-out ${exiting ? 'opacity-0' : 'opacity-100'}`}>
      <AuthLoading label={label} />
    </div>
  )
}
