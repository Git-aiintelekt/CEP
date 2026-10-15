/**
 * The suite's components as the shell knows them: GET /me/ says which of them a workspace can open; the registry
 * (apps/registry.ts) says how to draw each one and where its pages are. A component that is not built yet has no
 * manifest and only appears in the launcher's "coming" line.
 */
import { COMING, MANIFESTS } from '@/apps/registry'
import type { Me, SuiteComponent } from '@/lib/types'
import type { ComponentManifest } from './componentTypes'

export type { ComponentManifest }
export { COMING, MANIFESTS }

export interface EntitledComponent extends ComponentManifest {
  access: SuiteComponent['access']
  until: string | null
}

/** The components this person's workspace can open, in suite order. An older API that says nothing means Engagement alone. */
export function entitled(me: Me | null): EntitledComponent[] {
  const list = me?.components ?? [{ key: 'cep', name: 'Engagement', tagline: 'Customer Engagement', access: 'PLAN', until: null } satisfies SuiteComponent]
  return list.flatMap((item) => {
    const manifest = MANIFESTS[item.key]
    return manifest ? [{ ...manifest, access: item.access, until: item.until }] : []
  })
}

/** the component whose menu owns a path; Engagement owns everything it has no better owner for */
export function componentAt(pathname: string, components: EntitledComponent[]): EntitledComponent | null {
  const owner = components.find((component) => component.menu.some((item) => item.to !== '/' && (pathname === item.to || pathname.startsWith(`${item.to}/`))))
  return owner ?? components.find((component) => component.key === 'cep') ?? components[0] ?? null
}

/** the names of the components still to come, as one sentence for the launcher: the server's list, else the manifests' */
export function comingSentence(me: Me | null): string {
  const names = (me?.coming ?? COMING).map((item) => item.name)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is coming.`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are coming.`
}
