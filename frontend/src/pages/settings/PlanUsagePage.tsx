import { useQuery } from '@tanstack/react-query'

import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDate, formatNumber, titleize } from '@/lib/format'
import type { Invoice, Usage, UsageMeter } from '@/lib/types'

const money = (amount: number | string, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount))
const monthName = (iso: string) => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso))

const BAR: Record<UsageMeter['state'], string> = { ok: 'bg-brand-600', warning: 'bg-warning', over: 'bg-high', blocked: 'bg-danger-plain' }

function Meter({ meter, currency }: { meter: UsageMeter; currency: string }) {
  const unit = meter.unit ? ` ${meter.unit}` : ''
  const note = meter.limit === null ? 'No limit on this plan'
    : meter.state === 'blocked' ? 'The limit is reached and this plan has no overage'
    : meter.state === 'over' ? `Above the included amount: billed at ${money(meter.overage_price_per_1k ?? 0, currency)} per 1,000`
    : meter.state === 'warning' ? 'Close to the limit'
    : meter.overage ? `Then ${money(meter.overage_price_per_1k ?? 0, currency)} per 1,000` : 'Hard limit'
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-ink-800">{meter.label}</h3>
        {meter.percent !== null && <span className="text-xs font-semibold text-ink-800">{meter.percent}%</span>}
      </div>
      <p className="mt-1 text-xl font-semibold text-ink-900">
        {formatNumber(meter.used)}{unit}
        {meter.limit !== null && <span className="text-sm font-normal text-ink-800"> of {formatNumber(meter.limit)}{unit}</span>}
      </p>
      {meter.limit !== null && (
        <div role="progressbar" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(meter.percent ?? 0, 100)} className="mt-3 h-2 overflow-hidden rounded-full bg-fill-subtle">
          <div className={`h-full rounded-full ${BAR[meter.state]}`} style={{ width: `${Math.min(meter.percent ?? 0, 100)}%` }} />
        </div>
      )}
      <p className={`mt-2 text-xs ${meter.state === 'blocked' ? 'font-medium text-danger-text' : meter.state === 'ok' ? 'text-ink-800' : 'text-warning-text'}`}>{note}</p>
      {meter.note && <p className="mt-1 text-xs text-ink-800">{meter.note}</p>}
    </li>
  )
}

export function PlanUsagePage() {
  const usage = useQuery({ queryKey: ['workspace', 'usage'], queryFn: ({ signal }) => api.get<Usage>('/workspace/usage/', undefined, signal) })
  const invoices = useQuery({ queryKey: ['workspace', 'invoices'], queryFn: ({ signal }) => api.get<Invoice[]>('/workspace/invoices/', undefined, signal) })

  if (usage.isError) return <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
  if (usage.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading usage</p>

  const { plan, meters, breakdown, month, can_send } = usage.data
  const currency = plan?.currency ?? 'USD'
  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Invoice', render: (invoice) => <span className="font-medium text-ink-900">{invoice.invoice_number}</span> },
    { key: 'period', header: 'Period', render: (invoice) => monthName(invoice.period_month) },
    { key: 'plan', header: 'Plan', render: (invoice) => `${money(invoice.base_amount, invoice.currency)}${Number(invoice.overage_amount) ? ` + ${money(invoice.overage_amount, invoice.currency)} overage` : ''}` },
    { key: 'total', header: 'Total', align: 'right', render: (invoice) => <span className="font-semibold text-ink-900">{money(invoice.total_amount, invoice.currency)}</span> },
    { key: 'status', header: 'Status', render: (invoice) => <StatusBadge status={invoice.status === 'PAID' ? 'ACTIVE' : invoice.status === 'VOID' ? 'ARCHIVED' : 'SCHEDULED'} label={invoice.status === 'PAID' ? `Paid ${formatDate(invoice.paid_at)}` : invoice.status === 'VOID' ? 'Void' : `Due ${formatDate(invoice.due_at)}`} /> },
  ]

  return (
    <div className="space-y-6">
      {!can_send && (
        <p role="alert" className="rounded-lg border border-danger bg-danger-bg px-4 py-3 text-sm text-danger-text">
          This month's messages are used up, so campaigns cannot be published until next month. Talk to us about a larger plan to keep sending.
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-card-title font-semibold text-ink-900">{plan ? `${plan.name} Plan` : 'No Plan'}</h2>
          <p className="text-sm text-ink-800">
            {plan ? (plan.monthly_price ? `${money(plan.monthly_price, currency)} per month` : 'Custom pricing') : 'Usage is measured, but no limits apply.'} · usage for {monthName(month)}, refreshed every hour
          </p>
        </div>
        {plan && plan.status !== 'ACTIVE' && <StatusBadge status="SCHEDULED" label={titleize(plan.status)} />}
      </div>

      <ul aria-label="Usage" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">{meters.map((meter) => <Meter key={meter.label} meter={meter} currency={currency} />)}</ul>

      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink-800">Messages by Channel</h3>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
          {Object.entries(breakdown).map(([label, value]) => (
            <div key={label}><dt className="text-xs text-ink-800">{label}</dt><dd className="text-sm font-semibold text-ink-900">{formatNumber(value)}</dd></div>
          ))}
        </dl>
      </div>

      <div>
        <h2 className="mb-3 font-display text-section-title font-semibold text-ink-900">Invoices</h2>
        {invoices.isError ? <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
          : invoices.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading invoices</p>
          : invoices.data.length === 0 ? <EmptyState title="No invoices yet" hint="An invoice appears here once it has been issued, shortly after the end of each month." />
          : <DataTable columns={columns} rows={invoices.data} rowKey={(invoice) => invoice.id} caption="Invoices" />}
      </div>
    </div>
  )
}
