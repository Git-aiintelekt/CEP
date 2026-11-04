import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ErrorState } from '@/components/States'
import { firstHome, hasComponent } from '@/shell/manifests'

/** Engagement's pages, for a workspace that has Engagement. Without it, a page in the shell says so; a full-screen editor
 * takes the person to the home of the first component the workspace has. */
export function NeedsEngagement({ fullScreen = false }: { fullScreen?: boolean }) {
  const { me } = useAuth()
  if (hasComponent(me, 'cep')) return <Outlet />
  const home = firstHome(me)
  if (fullScreen && home) return <Navigate to={home} replace />
  return <ErrorState title="This workspace does not have Engagement" detail="Engagement's pages show here once the workspace has it. The platform team adds a component to the plan." />
}
