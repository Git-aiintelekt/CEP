/** A benchmark in words, pure: its three bands with the measure's unit, and the unit to show beside a number. */
import type { Benchmark } from '../types'
import { meaningNumber } from './meaningWords'

export function bandsOf(b: Pick<Benchmark, 'higher_is_better' | 'good' | 'act' | 'format'>) {
  const good = meaningNumber(b.good, b.format)
  const act = meaningNumber(b.act, b.format)
  return b.higher_is_better
    ? { good: `${good} or more`, watch: `${act} to ${good}`, act: `under ${act}` }
    : { good: `${good} or less`, watch: `${good} to ${act}`, act: `over ${act}` }
}

/** what goes beside a number typed for this measure: 95 %, $ 1,000 */
export function unitOf(format: string | null): { before: string; after: string } {
  if (format === 'percent') return { before: '', after: '%' }
  if (format === 'money') return { before: '$', after: '' }
  return { before: '', after: '' }
}
