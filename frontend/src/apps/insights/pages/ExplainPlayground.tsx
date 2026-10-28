/**
 * /dev/explain: Explain → What This Means without a backend, for screenshots. City HT's Sep03 campaign (busy case) is primed into the
 * query cache; ?state=sparse is a report with no benchmark (Net Sales by Category).
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { keys } from '../api'
import { ExplainPanel } from '../components/ExplainPanel'
import type { Meaning } from '../types'

const PARAMS = { campaign: ['Sep03 - Star Bag'], period: 'quarter' }
const link = (id: string, name: string) => ({ id, name })

const BUSY: Meaning = {
  verdict: { tone: 'act', chip: 'Act on the List', title: 'Delivery is likely on target; engagement is likely low.',
    summary: "805 of 835 emails delivered (96.4%). 2 people opened (about 0.25%) and 2 clicked (0.25%). Delivery's 95% range, 94.9% to 97.5%, crosses a band's edge: read it as likely, not certain." },
  figures: [
    { key: 'f_delivery_rate', label: 'Delivered', value: 96.4072, format: 'percent', band: 'good', sure: false, state: 'judged', range: [94.92, 97.47], words: 'Likely On Target', target: 'target 95.0%', earlier: 97.1, estimated: false },
    { key: 'f_bounce_rate', label: 'Hard Bounces', value: 3.473, format: 'percent', band: 'watch', sure: true, state: 'judged', range: [2.43, 4.94], words: 'Above Target', target: 'keep under 2.0%', earlier: 1.2, estimated: false },
    { key: 'people_opened', label: 'People Who Opened', value: 0.2484, format: 'percent', band: null, sure: false, state: 'estimate', range: [0.07, 0.9], words: '', target: '', earlier: null, estimated: true },
    { key: 'f_click_through_rate', label: 'Clicked', value: 0.2484, format: 'percent', band: 'act', sure: false, state: 'judged', range: [0.07, 0.9], words: 'Likely Low', target: 'target 1.5%', earlier: 1.1, estimated: false },
  ],
  reasons: [
    { text: '38 of 40 opens (95.0%) were machine opens, such as Apple Mail Privacy Protection (estimated from the email client).', report: link('r-devices', 'Opens by Device and Client') },
    { text: 'The most common failure reply: "550 5.2.1 The email account that you tried to reach is inactive", 5 of the 30 not delivered.', report: link('r-failures', 'Failure and Bounce Reasons') },
    { text: 'All 6 clicks were on one link: locations.cititrends.com. 0 unsubscribed.', report: link('r-links', 'Link Clicks') },
  ],
  actions: [
    { text: 'Hard bounces are above 2.0%: remove the 29 addresses that hard-failed.', kind: 'export_failed', label: 'Export the 29 Addresses', report: link('r-customers', 'Customer Detail') },
    { text: 'Clicks are under 1.5%: review the list and the offer before the next send.', kind: 'open', label: 'Open Customer Detail', report: link('r-customers', 'Customer Detail') },
    { text: 'Most opens are machine opens: compare campaigns on clicks, not opens.', kind: 'open', label: 'Open Campaign Comparison', report: link('r-comparison', 'Campaign Comparison') },
  ],
  read: { reports: 4, earlier: { campaigns: 5, from: '2026-07-16', to: '2026-08-27' }, benchmarks: 4, campaign: 'Sep03 - Star Bag' },
  notes: [], pack: 'email-campaigns', ready: true, can_set: true,
}

const SPARSE: Meaning = {
  verdict: { tone: 'none', chip: 'No Benchmark', title: 'Net Sales: $291K. Orders: 4,210.', summary: '' },
  figures: [
    { key: 'net_sales', label: 'Net Sales', value: 291034, format: 'money', band: null, sure: false, state: 'no_benchmark', range: null, words: 'No Target', target: '', earlier: null, estimated: false },
    { key: 'orders', label: 'Orders', value: 4210, format: 'integer', band: null, sure: false, state: 'no_benchmark', range: null, words: 'No Target', target: '', earlier: null, estimated: false },
  ],
  reasons: [{ text: 'Largest Category: Apparel, $78,500 (27.0% of Net Sales).', report: null }, { text: 'Smallest: Home, $13,100 (4.5%).', report: null }],
  actions: [], read: { reports: 1, earlier: null, benchmarks: 0, campaign: null },
  notes: ['No target is set for Net Sales, Orders, so the verdict cannot say good or bad.'], pack: null, ready: true, can_set: true,
}

export default function ExplainPlayground() {
  const [search] = useSearchParams()
  const client = useQueryClient()
  const sparse = search.get('state') === 'sparse'
  const id = sparse ? 'rep-sales' : 'rep-sep03'
  const params = sparse ? undefined : PARAMS
  const [primed] = useState(() => { client.setQueryData(keys.meaning(id, params), sparse ? SPARSE : BUSY); return true })
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 bg-surface p-6">
      <h1 className="text-page-title font-semibold text-ink-900">{sparse ? 'Net Sales by Category and Month' : 'Delivery Outcomes'}</h1>
      {primed && <ExplainPanel reportId={id} reportName={sparse ? 'Net Sales by Category and Month' : 'Delivery Outcomes'} params={params} onClose={() => undefined}
        ai={sparse ? null : { explain: () => undefined, pending: false, error: null, explanation: null, asked: true }} />}
    </div>
  )
}
