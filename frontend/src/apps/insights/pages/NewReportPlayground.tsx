/**
 * /dev/new-report: New Report on sample data, with no backend: the built-in datasets, two connected databases (MySQL and
 * ClickHouse) with a mapped dataset, two uploaded files, and Connect a Database answering Test Connection, Save and the tables.
 * ?state=sparse for a workspace with nothing connected or uploaded. A host with "loyalty" in it tests as an account that can write.
 * For design review and screenshots; the real page is NewReportPage.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { keys } from '../api'
import type { CatalogDataset, CatalogField, QueryTarget } from '../types'
import { NewReportPage } from './NewReportPage'

const field = (key: string, label: string, role: 'dimension' | 'measure', type: CatalogField['type'] = role === 'measure' ? 'number' : 'string'): CatalogField =>
  ({ key, label, type, role, aggregates: role === 'measure' ? ['sum'] : [], operators: ['='], buckets: [], format: role === 'measure' ? 'integer' : null, sensitivity: 'NORMAL' })
const engagement = { key: 'cep', name: 'Engagement' }
const BUILT_IN: CatalogDataset[] = [
  { key: 'messages', label: 'Messages', description: 'Every email and text sent, with its outcome', component: engagement, primary_key: '', time_field: '', freshness: 'LIVE',
    fields: [field('channel', 'Channel', 'dimension'), field('campaign', 'Campaign', 'dimension'), field('sent', 'Sent Count', 'measure')] },
  { key: 'attributed_orders', label: 'Attributed Orders', description: 'Orders credited to a campaign', component: engagement, primary_key: '', time_field: '', freshness: 'LIVE',
    fields: [field('store', 'Store', 'dimension'), field('amount', 'Amount', 'measure')] },
]
const OWN: CatalogDataset = { key: 'x_daily_store_sales', label: 'Daily Store Sales', description: 'Mapped table', component: engagement, primary_key: '', time_field: '', freshness: 'LIVE', kind: 'table',
  database: { id: 'db-1', name: 'Store Sales', engine: 'mysql80', engine_name: 'MySQL 8.0' }, fields: [field('store', 'Store', 'dimension'), field('day', 'Day', 'dimension', 'date'), field('net_sales', 'Net Sales', 'measure')] }
const FILE: CatalogDataset = { key: 'upl_pos_transactions', label: 'POS Transactions', description: null, component: engagement, primary_key: '', time_field: '', freshness: 'LIVE', kind: 'upload',
  upload: { id: 'upl-1', file_name: 'pos_transactions.csv', row_count: 12480, updated_at: '2026-10-21T09:00:00Z' }, fields: [field('store', 'Store', 'dimension'), field('total', 'Total', 'measure')] }
const TARGETS: QueryTarget[] = [
  { id: 'db-1', name: 'Store Sales', engine: 'mysql80', engine_name: 'MySQL 8.0', database_name: 'retail_db', schema_name: 'retail_db' },
  { id: 'db-2', name: 'Events Warehouse', engine: 'clickhouse', engine_name: 'ClickHouse', database_name: 'events', schema_name: 'events' },
]
const GOOD = { ok: true, version: '24.8.4.13', timezone: 'UTC', tables: 38, views: 4, read_only: true, offending: [], ms: 210, error: null }
const WRITER = { ok: true, version: '24.8.4.13', timezone: 'UTC', tables: 38, views: 4, read_only: false, offending: ['INSERT, ALTER, DROP on events.*'], ms: 190, error: null }
const SOURCES = [
  { name: 'orders_daily', kind: 'view', rows: null, columns: 7, mappable: true, mapped_as: null },
  { name: 'page_views', kind: 'table', rows: 48200000, columns: 12, mappable: true, mapped_as: null },
  { name: 'sessions', kind: 'table', rows: 9100000, columns: 15, mappable: true, mapped_as: null },
  { name: 'campaign_clicks', kind: 'table', rows: 2300000, columns: 9, mappable: true, mapped_as: 'Campaign Clicks' },
]

let installed = false
/** answers Connect a Database's calls on this page only */
function installSampleConnections() {
  if (installed) return
  installed = true
  const original = window.fetch.bind(window)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  window.fetch = async (input, init) => {
    const url = new URL(String(input), window.location.origin)
    if (!window.location.pathname.startsWith('/dev/new-report') || !url.pathname.includes('/workspace/report-databases/')) return original(input, init)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (url.pathname.endsWith('/report-databases/test/')) return json({ test: String(body.host ?? '').includes('loyalty') ? WRITER : GOOD })
    if (url.pathname.endsWith('/report-databases/') && init?.method === 'POST') {
      return json({ id: 'db-new', name: body.name, engine: body.engine, engine_name: body.engine === 'clickhouse' ? 'ClickHouse' : 'MySQL 8.0', host: body.host, port: body.port, database_name: body.database,
        schema_name: body.database, username: body.username, ssl_mode: body.ssl, status: 'ACTIVE', last_tested_at: null, last_test_ok: true, last_test_error: null, read_only: true, server_version: GOOD.version,
        server_timezone: 'UTC', created_at: '', updated_at: '', row_version: 1, usable: true, test: GOOD }, 201)
    }
    if (url.pathname.endsWith('/sources/')) return json({ sources: SOURCES })
    return original(input, init)
  }
}

/** the suite's components, as the catalogue gives them */
const SUITE = [{ key: 'cep', name: 'Engagement' }, { key: 'insights', name: 'Insights' }, { key: 'crm', name: 'CRM' }, { key: 'sales', name: 'Sales' }, { key: 'pur', name: 'Purchasing' }, { key: 'inv', name: 'Inventory' }, { key: 'pim', name: 'PIM' }]

export default function NewReportPlayground() {
  installSampleConnections()
  const [params] = useSearchParams()
  const sparse = params.get('state') === 'sparse'
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(keys.catalog, { datasets: sparse ? BUILT_IN : [...BUILT_IN, OWN, FILE], engine: { engine: 'clickhouse', name: 'ClickHouse' }, components: SUITE, can_choose_component: true })
    client.setQueryData(['workspace', 'report-databases', 'targets'], { databases: sparse ? [] : TARGETS })
    return null
  })
  return <NewReportPage canConnect bare />
}
