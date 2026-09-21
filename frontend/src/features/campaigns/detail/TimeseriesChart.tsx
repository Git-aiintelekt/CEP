/** Sent / delivered / opened / clicked over time, as lines. Drawn as SVG here: four series do not justify a chart library. The same numbers follow as a table. */
import { formatNumber } from '@/lib/format'
import type { CampaignTimeseries } from '@/lib/types'

const SERIES = [
  { key: 'sent', label: 'Sent', color: 'var(--color-ink-700)' },
  { key: 'delivered', label: 'Delivered', color: 'var(--color-brand-600)' },
  { key: 'opened', label: 'Opened', color: 'var(--color-wordmark-teal)' },
  { key: 'clicked', label: 'Clicked', color: 'var(--color-high)' },
] as const

const W = 720
const H = 240
const PAD = { left: 48, right: 16, top: 12, bottom: 28 }

export function TimeseriesChart({ data, texts }: { data: CampaignTimeseries; texts: boolean }) {
  const series = SERIES.filter((item) => !texts || item.key === 'sent' || item.key === 'delivered')
  const points = data.points
  if (points.length === 0) return <p className="text-sm text-ink-500">Nothing has been sent yet. The chart fills in as messages go out.</p>

  const top = Math.max(1, ...points.flatMap((point) => series.map((item) => point[item.key])))
  const x = (index: number) => PAD.left + (points.length === 1 ? (W - PAD.left - PAD.right) / 2 : (index * (W - PAD.left - PAD.right)) / (points.length - 1))
  const y = (value: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - value / top)
  const label = (iso: string) => new Intl.DateTimeFormat(undefined, data.bucket === 'day' ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: 'numeric' }).format(new Date(iso))
  const ticks = [0, 0.5, 1].map((part) => Math.round(top * part))
  const every = Math.max(1, Math.ceil(points.length / 6))

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Messages ${series.map((item) => item.label.toLowerCase()).join(', ')} per ${data.bucket}`} className="h-auto w-full">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-500)">{formatNumber(tick)}</text>
          </g>
        ))}
        {points.map((point, index) => index % every === 0 && (
          <text key={point.at} x={x(index)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-ink-500)">{label(point.at)}</text>
        ))}
        {series.map((item) => (
          <g key={item.key}>
            <polyline fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" points={points.map((point, index) => `${x(index)},${y(point[item.key])}`).join(' ')} />
            {points.length <= 24 && points.map((point, index) => <circle key={point.at} cx={x(index)} cy={y(point[item.key])} r="3" fill={item.color} />)}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4" style={{ backgroundColor: item.color }} />{item.label}</span>
        ))}
      </figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-brand-800">Show the numbers</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-surface-subtle"><tr><th scope="col" className="h-9 px-3 text-left text-xs font-semibold text-ink-700">{data.bucket === 'day' ? 'Day' : 'Hour'}</th>
              {series.map((item) => <th key={item.key} scope="col" className="h-9 px-3 text-right text-xs font-semibold text-ink-700">{item.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {points.map((point) => (
                <tr key={point.at}><th scope="row" className="px-3 py-1.5 text-left font-normal text-ink-700">{label(point.at)}</th>
                  {series.map((item) => <td key={item.key} className="cep-num px-3 py-1.5 text-right text-ink-900">{formatNumber(point[item.key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
