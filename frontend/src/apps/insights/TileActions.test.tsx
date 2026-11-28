/**
 * Where a grid tile leads (docs/build-prompts/reports-into-insights.md, R3): ticked lines open another report with them picked,
 * a campaign's name carries an arrow to it in Engagement, a tile with nothing in the period says so in its own words; and a link
 * to Engagement's reports opens the Engagement Overview dashboard once the workspace has it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { insightFrom } from '@/apps/cep/features/home/insightFrom'
import type { Me } from '@/lib/types'
import { entitled, reportsPath } from '@/shell/manifests'
import { me } from '@/test/mockApi'
import { TileCard } from './dashboards/TileCard'
import { gridLinks, stillThere, tickedPath, tickWords } from './dashboards/tileActions'
import type { DashboardTile, RunResult, TileResult, TileTick } from './types'

afterEach(cleanup)

const TICK: TileTick = { field: 'campaign_name', report_id: 'rep-compare', parameter: 'campaign', period: 'period', label: 'Compare Campaigns', min: 2, max: 3 }
const TILE: DashboardTile = {
  id: 'campaigns', report_id: 'rep-campaigns', show: 'grid', title: 'Campaigns in the Period', tick: TICK,
  empty: { title: 'No Campaign Sent in This Period', text: 'Results show here from the first send.', label: 'Go to Campaigns', to: '/campaigns' },
}
const BOUNDS = { from: '2026-10-01', to: '2026-10-30', previous_from: '2026-09-01', previous_to: '2026-09-30' }
const rows = (names: string[]): RunResult => ({
  columns: [{ key: 'campaign_name', label: 'Campaign', type: 'string', format: null }, { key: 'sent', label: 'Sent', type: 'number', format: 'integer', aggregate: 'sum' }],
  rows: names.map((name, at) => [name, 1000 * (at + 1)]), row_count: names.length, duration_ms: 1, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
} as RunResult)
const view = (names: string[], links = true): TileResult => ({
  kind: 'view', view: { type: 'grid' }, result: rows(names), own_dates: false, bounds: BOUNDS, report: { id: 'rep-campaigns', name: 'Campaigns in the Period', version: 1, dataset: 'messages' }, sliced: [],
  ...(links ? { links: [{ column: 'campaign_name', kind: 'campaign' as const, ids: { 'Fall Launch': 'c-1', 'Winter Coats': 'c-2' } }] } : {}),
})

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}{decodeURIComponent(location.search)}</p>
}

function renderTile(result: TileResult, tile: DashboardTile = TILE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/insights/dashboards/d1']}>
        <Routes>
          <Route path="/insights/dashboards/d1" element={<TileCard tile={tile} period={{ preset: '30d' }} compare={false} load={async () => result} keyPrefix={['test']} onPick={() => undefined} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return screen.findByRole('region', { name: 'Campaigns in the Period' })
}

test('the address of the report ticked lines open: the values under its question, the tile\'s dates under its period', () => {
  const path = tickedPath(TICK, ['Fall Launch', 'Winter Coats'], BOUNDS)
  expect(path.startsWith('/insights/reports/rep-compare?ask=')).toBe(true)
  expect(JSON.parse(decodeURIComponent(path.split('ask=')[1]))).toEqual({ campaign: ['Fall Launch', 'Winter Coats'], period: ['2026-10-01', '2026-10-30'] })
  const { period: _none, ...plain } = TICK
  expect(JSON.parse(decodeURIComponent(tickedPath(plain, ['A'], BOUNDS).split('ask=')[1]))).toEqual({ campaign: ['A'] })       // no period question named: its own default
  expect(JSON.parse(decodeURIComponent(tickedPath(TICK, ['A'], null).split('ask=')[1]))).toEqual({ campaign: ['A'] })          // a tile on its own dates
})

test('a name leads to its campaign or journey in Engagement; a name with no id leads nowhere', () => {
  const links = gridLinks([{ column: 'campaign_name', kind: 'campaign', ids: { 'Fall Launch': 'c-1' } }, { column: 'journey_name', kind: 'journey', ids: { Welcome: 'j-9' } }])
  expect(links?.campaign_name('Fall Launch')).toEqual({ to: '/campaigns/c-1', label: 'Open the campaign Fall Launch in Engagement' })
  expect(links?.campaign_name('Two of These')).toBeNull()
  expect(links?.journey_name('Welcome')).toEqual({ to: '/journeys/j-9', label: 'Open the journey Welcome in Engagement' })
  expect(gridLinks(undefined)).toBeUndefined()
  expect(gridLinks([])).toBeUndefined()
})

test('a ticked line that left the rows is no longer counted, and the hint counts in words', () => {
  expect(stillThere(['Fall Launch', 'Gone'], rows(['Fall Launch', 'Winter Coats']), 'campaign_name')).toEqual(['Fall Launch'])
  expect(stillThere(['Fall Launch'], rows(['Fall Launch']), 'no_such_column')).toEqual([])
  expect(tickWords(TICK)).toBe('Tick 2 to 3 lines first')
  expect(tickWords({ ...TICK, min: 1, max: 1 })).toBe('Tick 1 line first')
})

test('ticking lines turns the button on between the least and the most, and it opens the report with them picked', async () => {
  const user = userEvent.setup()
  const tile = await renderTile(view(['Fall Launch', 'Winter Coats', 'Spring Sale', 'Summer Sale']))
  const button = await within(tile).findByRole('button', { name: 'Compare Campaigns' })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(button.getAttribute('title')).toBe('Tick 2 to 3 lines first')
  const boxes = await within(tile).findAllByRole('checkbox')
  expect(boxes).toHaveLength(4)                                                              // a box a line, none in the header

  await user.click(boxes[0])
  expect((await within(tile).findByRole('button', { name: 'Compare Campaigns (1)' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(boxes[1])
  const ready = await within(tile).findByRole('button', { name: 'Compare Campaigns (2)' }) as HTMLButtonElement
  expect(ready.disabled).toBe(false)
  await user.click(boxes[2])
  await user.click(boxes[3])
  expect((await within(tile).findByRole('button', { name: 'Compare Campaigns (4)' }) as HTMLButtonElement).disabled).toBe(true)      // more than the most
  await user.click(boxes[3])
  await user.click(boxes[2])

  await user.click(await within(tile).findByRole('button', { name: 'Compare Campaigns (2)' }))
  const where = (await screen.findByTestId('where')).textContent ?? ''
  expect(where.startsWith('/insights/reports/rep-compare?ask=')).toBe(true)
  expect(JSON.parse(where.split('ask=')[1])).toEqual({ campaign: ['Fall Launch', 'Winter Coats'], period: ['2026-10-01', '2026-10-30'] })
})

test('a campaign\'s name carries an arrow to it; a name with no campaign behind it carries none', async () => {
  const tile = await renderTile(view(['Fall Launch', 'Winter Coats', 'Spring Sale']))
  const arrow = await within(tile).findByRole('link', { name: 'Open the campaign Fall Launch in Engagement' })
  expect(arrow.getAttribute('href')).toBe('/campaigns/c-1')
  expect(within(tile).getByRole('link', { name: 'Open the campaign Winter Coats in Engagement' }).getAttribute('href')).toBe('/campaigns/c-2')
  expect(within(tile).queryByRole('link', { name: /Spring Sale/ })).toBeNull()
  expect(within(tile).getByText('Spring Sale')).toBeTruthy()
})

test('a tile without ticking or links is the plain grid: no boxes, no button, no arrows', async () => {
  const { tick: _tick, ...plain } = TILE
  const tile = await renderTile(view(['Fall Launch', 'Winter Coats'], false), plain)
  expect(await within(tile).findByText('Fall Launch')).toBeTruthy()
  expect(within(tile).queryAllByRole('checkbox')).toHaveLength(0)
  expect(within(tile).queryByRole('button', { name: /Compare Campaigns/ })).toBeNull()
  expect(within(tile).queryAllByRole('link')).toHaveLength(0)
})

test('nothing in the period: the tile\'s own words and its button, no grid, no Compare, nothing said about clicking', async () => {
  const tile = await renderTile(view([]))
  expect(await within(tile).findByText('No Campaign Sent in This Period')).toBeTruthy()
  expect(within(tile).getByText('Results show here from the first send.')).toBeTruthy()
  expect(within(tile).getByRole('link', { name: 'Go to Campaigns' }).getAttribute('href')).toBe('/campaigns')
  expect(within(tile).queryByRole('button', { name: /Compare Campaigns/ })).toBeNull()
  expect(within(tile).queryByText(/filter the other tiles/)).toBeNull()
  expect(within(tile).queryByText('No rows match this report.')).toBeNull()
})

const INSIGHTS = { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }
const withOverview = { ...me, components: [...me.components, INSIGHTS], insights: { ...(me as unknown as Me).insights, engagement_overview: 'dash-9' } } as unknown as Me

test('a link to Engagement\'s reports: the Engagement Overview dashboard once the workspace has Insights and the dashboard, else its own page', () => {
  expect(reportsPath(withOverview)).toBe('/insights/dashboards/dash-9')
  expect(reportsPath({ ...withOverview, insights: { ...withOverview.insights, engagement_overview: null } } as Me)).toBe('/reports')
  expect(reportsPath({ ...withOverview, components: withOverview.components?.filter((item) => item.key !== 'insights') } as Me)).toBe('/reports')      // Insights taken away: the id is not followed
  expect(reportsPath(null)).toBe('/reports')
  const reports = entitled(withOverview).find((component) => component.key === 'cep')?.menu.find((item) => item.label === 'Reports')
  expect(reports).toMatchObject({ to: '/insights/dashboards/dash-9', opens: 'Insights' })
})

test('Home\'s opportunity leads where the reports are', () => {
  const channels = [{ channel: 'EMAIL', delivered: 1000, opened: 400, clicked: 50, converted: 40 }, { channel: 'SMS', delivered: 500, opened: null, clicked: 20, converted: 5 }]
  expect(insightFrom(channels as never)?.href).toBe('/reports')
  expect(insightFrom(channels as never, '/insights/dashboards/dash-9')?.href).toBe('/insights/dashboards/dash-9')
})
