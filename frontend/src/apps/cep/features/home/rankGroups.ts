import type { AttentionGroup, Severity } from './data/types'

const RANK: Record<Severity, number> = { critical: 0, blocking: 1, governance: 2 }

/** red, then amber, then periwinkle; the larger count first within each */
export const rankGroups = (groups: AttentionGroup[]) => [...groups].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count)
