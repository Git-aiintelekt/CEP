import type { Governance } from './data/types'

/** the share of the audience the frequency cap let through: 100% when it held nobody back */
export function capCompliance(data: Governance): number {
  const audience = data.contacted + data.heldBack
  return audience ? ((audience - data.reasons.frequencyCap) / audience) * 100 : 100
}
