/**
 * An embed link's page (/embed/:code/:secret): a report or a dashboard, read-only, for another site's frame. No sign-in and
 * no app around it; the address carries the workspace and the link's secret, and the API answers what the link's maker may
 * see with personal data masked. A revoked or expired link says so in words.
 */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { ErrorState, Spinner } from '@/components/States'
import { API_BASE_URL } from '@/lib/config'
import { ReportResult } from '../components/ReportViews'
import { runWords } from '../components/resultWords'
import { DashboardBody } from '../dashboards/DashboardBody'
import { periodWords } from '../dashboards/layout'
import { containerOf, pagesOf } from '../dashboards/pages'
import { themeStyle } from '../dashboards/themes'
import type { PublicEmbed, TileResult } from '../types'

class EmbedProblem extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function publicCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/public/embed/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new EmbedProblem(response.status, (body as { detail?: string }).detail ?? 'This link does not open.')
  return body as T
}

export default function EmbedPage() {
  const { code = '', secret = '' } = useParams()
  const base = `${encodeURIComponent(code)}/${encodeURIComponent(secret)}`
  const page = useQuery({ queryKey: ['insights', 'embed', code, secret], queryFn: () => publicCall<PublicEmbed>(`${base}/`), retry: false, staleTime: 60_000 })

  if (page.isPending) return <div className="p-6"><Spinner label="Loading" /></div>
  if (page.isError) {
    const gone = page.error instanceof EmbedProblem && page.error.status === 404
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface p-6">
        {gone ? <p className="max-w-prose text-center text-sm text-ink-800">{page.error.message} Ask whoever shared it for a new link.</p>
          : <ErrorState error={page.error} onRetry={() => page.refetch()} />}
      </main>
    )
  }
  const data = page.data
  return (
    <main className="report-density flex min-h-dvh flex-col gap-3 bg-surface p-4 md:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-card-heading font-semibold text-ink-900">{data.name}</h1>
        <span className="text-xs text-ink-800">
          {data.kind === 'report' ? runWords(data.result) : periodWords(data.bounds)} · {data.workspace}
        </span>
      </header>
      {data.kind === 'report' ? (
        <ReportResult result={data.result} view={data.view} label={`${data.name} rows`} />
      ) : (
        <EmbeddedDashboard data={data} base={base} />
      )}
      <footer className="text-xs text-ink-700">Read-only. Personal data is masked.</footer>
    </main>
  )
}

function EmbeddedDashboard({ data, base }: { data: Extract<PublicEmbed, { kind: 'dashboard' }>; base: string }) {
  const pages = pagesOf(data.layout)
  return (
    <div className="flex flex-col gap-6" style={themeStyle(data.layout.theme)}>
      {pages.map((page) => (
        <section key={page.id} aria-label={pages.length > 1 ? page.title : data.name} className="flex flex-col gap-3">
          {pages.length > 1 && <h2 className="text-sm font-semibold text-ink-900">{page.title}</h2>}
          <DashboardBody layout={{ ...data.layout, ...containerOf(data.layout, page.id) }} period={data.period} compare={data.compare} keyPrefix={['insights', 'embed-tiles', base]}
            load={(tile) => publicCall<TileResult>(`${base}/tiles/${encodeURIComponent(tile.id)}/run/`, { method: 'POST', body: '{}' })} />
        </section>
      ))}
    </div>
  )
}
