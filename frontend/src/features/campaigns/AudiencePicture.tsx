/** Who a campaign would reach: lists merged, duplicates removed, exclusions taken out, then today's governance check. */
import { formatNumber } from '@/lib/format'
import type { CampaignAudience } from '@/lib/types'

import { audienceFunnel, statusReason } from './audienceNumbers'

function Line({ label, value, strong = false, minus = false }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 text-sm ${strong ? 'font-semibold text-ink-900' : 'text-ink-800'}`}>
      <dt>{label}</dt>
      <dd className="cep-num">{minus && value > 0 ? '−' : ''}{formatNumber(value)}</dd>
    </div>
  )
}

export function AudiencePicture({ audience }: { audience: CampaignAudience }) {
  const left = audience.statuses.filter((line) => !line.sendable && line.count > 0)
  return (
    <div>
      <dl className="divide-y divide-line-subtle" aria-label="Audience Estimate">
        {audienceFunnel(audience).map((line) => <Line key={line.label} {...line} />)}
      </dl>
      {left.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-800" aria-label="Why people are left out">
          {left.map((line) => (
            <li key={line.code} className="flex justify-between gap-3">
              <span>{statusReason(line.code, line.label, audience.channel)}</span>
              <span className="cep-num">{formatNumber(line.count)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-800">{audience.note}</p>
    </div>
  )
}
