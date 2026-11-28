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

const REPORTS = '/reports'

/**
 * The components this person's workspace can open, in suite order. An older API that says nothing means Engagement alone.
 * Engagement's Reports leads to the Engagement Overview dashboard in Insights once the workspace has both and has added
 * Engagement Reports (docs/mockups/reports-into-insights.html, option A); until then it opens Engagement's own page.
 */
export function entitled(me: Me | null): EntitledComponent[] {
  const list = me?.components ?? [{ key: 'cep', name: 'Engagement', tagline: 'Customer Engagement', access: 'PLAN', until: null } satisfies SuiteComponent]
  const reports = reportsPath(me)
  return list.flatMap((item) => {
    const manifest = MANIFESTS[item.key]
    if (!manifest) return []
    const menu = item.key === 'cep' && reports !== REPORTS ? manifest.menu.map((page) => (page.to === REPORTS ? { ...page, to: reports, opens: 'Insights' } : page)) : manifest.menu
    return [{ ...manifest, menu, access: item.access, until: item.until }]
  })
}

/** where a link to Engagement's reports leads: the Engagement Overview dashboard when the workspace has Insights and has added it, else Engagement's own page */
export function reportsPath(me: Me | null): string {
  const overview = me?.components?.some((item) => item.key === 'insights') ? me?.insights?.engagement_overview : null
  return overview ? `/insights/dashboards/${overview}` : REPORTS
}

/** whether the workspace has a component (an older API that says nothing means Engagement alone) */
export const hasComponent = (me: Me | null, key: string): boolean => entitled(me).some((component) => component.key === key)

/** the first component's home: where "/" takes someone whose workspace has no Engagement */
export const firstHome = (me: Me | null): string | null => entitled(me)[0]?.home ?? null

/** the component whose menu owns a path (an item that opens another app owns nothing); Engagement owns everything it has no better owner for */
export function componentAt(pathname: string, components: EntitledComponent[]): EntitledComponent | null {
  const owner = components.find((component) => component.menu.some((item) => !item.opens && item.to !== '/' && (pathname === item.to || pathname.startsWith(`${item.to}/`))))
  return owner ?? components.find((component) => component.key === 'cep') ?? components[0] ?? null
}

/** the names of the components still to come, as one sentence for the launcher: the server's list, else the manifests' */
export function comingSentence(me: Me | null): string {
  const names = (me?.coming ?? COMING).map((item) => item.name)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is coming.`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are coming.`
}
