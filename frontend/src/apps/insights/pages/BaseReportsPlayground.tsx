/**
 * /dev/base-reports: Add Base Reports without a backend, for the guide's screenshots. The catalogue is primed into the query cache and
 * the sources, check and add calls are answered here with City HT's Postal databases. ?step=data opens the second step, &check=1 runs
 * the check there; ?step=done adds the pack; ?state=empty has no MySQL connection (the sparse case).
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { BaseReportsDialog } from '../components/BaseReportsDialog'
import type { BasePackAdded, BasePackCheck, BasePackSources, BaseReportsCatalog } from '../types'

const DATASETS = ['Email Messages', 'Email Campaigns', 'Email Link Clicks', 'Email Opens']
const REPORTS = ['Campaign KPIs', 'All Campaigns Totals', 'Campaign Send Status', 'Delivery Outcomes', 'Failure and Bounce Reasons', 'Provider Performance', 'Retry Analysis',
  'Contact-List Quality', 'Link Clicks', 'Opens by Device and Client', 'Opens over Time', 'Customer Detail', 'Unsubscribes', 'Campaign Comparison', 'Best Campaigns by Open Rate',
  'Lowest Delivery Rate Campaigns']
const DASHBOARDS = ['Management Dashboard', 'Campaign Performance']

const catalog = (empty: boolean): BaseReportsCatalog => ({
  can_add: true, recorded: true,
  connections: empty ? [] : [{ id: 'db-postal', name: 'Citi-Postal mySQL8', engine: 'mysql80', database: 'citi_analysis_db', usable: true }, { id: 'db-tt', name: 'Citi-TT-Analysis DB 8.0', engine: 'mysql80', database: 'citi_analysis_db', usable: true }],
  packs: [{
    key: 'email-campaigns', version: 1, name: 'Email Campaign Reports', source: 'CmpReport',
    summary: 'Campaign KPIs, send status, delivery and retries, failures and bounces, providers, list quality, link clicks, opens by device and client, customer detail, unsubscribes and comparisons; a Management Dashboard and a Campaign Performance dashboard.',
    needs: { label: 'a Postal database', engine: 'mysql', tables: ['messages', 'deliveries', 'loads', 'clicks', 'links'] },
    contents: { datasets: DATASETS, reports: REPORTS, dashboards: DASHBOARDS }, added: [],
  }],
})
const SOURCES: BasePackSources = {
  databases: [{ name: 'mailpostal-server-14', messages: 26458, marketing: 919 }, { name: 'txpostalprod-server-10', messages: 17853, marketing: 41 }, { name: 'txpostalprod-server-7', messages: 1290, marketing: 0 }],
  names: [{ table: 'citi_analysis_db.marketing_campaign', id: 'MARKETING_CAMPAIGN_ID', name: 'CAMPAIGN_NAME' }],
}
const CHECK: BasePackCheck = { ok: true, campaigns: 22, days: 90, problems: [], datasets: DATASETS.map((label, i) => ({ label, ok: true, seconds: [0.3, 0.2, 0.1, 0.1][i] })) }
const ADDED: BasePackAdded = { version: 1, recorded: true, folder: { id: 'fold-1', name: 'Email Campaign Reports' }, datasets: DATASETS.map((label, i) => ({ key: `x_${i}`, label })),
  reports: REPORTS.map((name, i) => ({ id: `r${i}`, name })), dashboards: DASHBOARDS.map((name, i) => ({ id: `d${i}`, name })) }

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const press = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name || b.textContent?.trim().startsWith(name))?.click()

export default function BaseReportsPlayground() {
  const client = useQueryClient()
  const [params] = useSearchParams()
  const step = params.get('step')
  const [primed] = useState(() => { client.setQueryData(['insights', 'base-reports'], catalog(params.get('state') === 'empty')); return true })
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const real = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/sources/')) return reply(SOURCES)
      if (url.includes('/check/')) { await new Promise((resolve) => setTimeout(resolve, 500)); return reply(CHECK) }
      if (url.includes('/add/')) { await new Promise((resolve) => setTimeout(resolve, 800)); return reply(ADDED) }
      if (url.includes('/insights/base-reports/')) return reply(catalog(params.get('state') === 'empty'))
      return real(input, init)
    }
    return () => { window.fetch = real }
  }, [params])
  useEffect(() => {
    if (step !== 'data' && step !== 'done') return
    const timers = [setTimeout(() => press('Add to'), 300)]
    if (step === 'done' || params.get('check')) timers.push(setTimeout(() => press('Check'), 900))
    if (step === 'done') timers.push(setTimeout(() => press('Add Reports'), 1800))
    return () => timers.forEach(clearTimeout)
  }, [step, params])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <h1 className="font-display text-page-title font-semibold text-ink-900">All Reports</h1>
      {!open && <button type="button" className="self-start text-sm font-semibold text-brand-800" onClick={() => setOpen(true)}>Add Base Reports</button>}
      {primed && open && <BaseReportsDialog onClose={() => setOpen(false)} />}
    </main>
  )
}
