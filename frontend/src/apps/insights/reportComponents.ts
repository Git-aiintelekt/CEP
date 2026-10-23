import { useCatalog } from './api'

/** the suite's components a report may be listed under (from the catalogue, so one added later is offered too), whether the
 * database can keep a report's own (patch 0075), and a component's name by its key */
export function useComponents(): { components: { key: string; name: string }[]; ready: boolean; nameOf: (key: string | null | undefined) => string | null } {
  const catalog = useCatalog()
  const components = catalog.data?.components ?? []
  return { components, ready: Boolean(catalog.data?.can_choose_component) && components.length > 0, nameOf: (key) => components.find((c) => c.key === key)?.name ?? null }
}
