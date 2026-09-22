/** Who a campaign would reach: lists merged, duplicates removed, exclusions taken out, then today's governance check. */
import { formatNumber } from '@/lib/format'
import type { CampaignAudience } from '@/lib/types'

function Line({ label, value, strong = false, minus = false }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 text-sm ${strong ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
      <dt>{label}</dt>
      <dd className="cep-num">{minus && value > 0 ? '−' : ''}{formatNumber(value)}</dd>
    </div>
  )
}

export function AudiencePicture({ audience }: { audience: CampaignAudience }) {
  const left = audience.statuses.filter((line) => !line.sendable && line.count > 0)
  return (
    <div>
      <dl className="divide-y divide-line-subtle" aria-label="Audience estimate">
        <Line label="In the attached lists" value={audience.gross} />
        <Line label="In more than one list (counted once)" value={audience.duplicates_removed} minus />
        <Line label="Removed by excluded lists" value={audience.excluded_by_list} minus />
        <Line label="Unique people" value={audience.after_exclusions} strong />
        <Line label={audience.marketing ? 'Left out by governance today' : 'Cannot be reached today'} value={audience.excluded_by_governance} minus />
        <Line label="Estimated recipients" value={audience.estimated_recipients} strong />
      </dl>
      {left.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-500" aria-label="Why people are left out">
          {left.map((line) => (
            <li key={line.code} className="flex justify-between gap-3">
              <span>{line.label}</span>
              <span className="cep-num">{formatNumber(line.count)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-500">{audience.note}</p>
    </div>
  )
}
