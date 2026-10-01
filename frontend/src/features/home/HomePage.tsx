/**
 * Home, the operating cockpit: the greeting with the Create New buttons beside it, Needs Attention as a strip, Marketing Performance with the page-wide filters, then
 * the cards: the designed rows when all are there, otherwise two per row (see homeLayout).
 */
import { Fragment, type ReactNode } from 'react'

import { greetingFor } from '@/lib/format'

import { createNewTiles } from './createNewTiles'
import { useHomeData } from './data/homeDataContext'
import type { HomeFilters, SectionResult } from './data/types'
import { homeLayout, type Availability, type CardKey, type LayoutRow } from './homeLayout'
import { ActiveJourneys } from './sections/ActiveJourneys'
import { CreateNew } from './sections/CreateNew'
import { EngagementFunnel } from './sections/EngagementFunnel'
import { EReceiptsTile } from './sections/EReceiptsTile'
import { GovernanceTile } from './sections/GovernanceTile'
import { MarketingPerformance } from './sections/MarketingPerformance'
import { NeedsAttention } from './sections/NeedsAttention'
import { NextSevenDays } from './sections/NextSevenDays'
import { RecentCampaigns } from './sections/RecentCampaigns'
import { RevenueCost } from './sections/RevenueCost'
import { TopBottom } from './sections/TopBottom'
import { useHomeFilters } from './useHomeFilters'

function availabilityOf<T>(result: SectionResult<T>, isEmpty: (data: T) => boolean = () => false): Availability {
  if (result.status === 'unavailable') return 'unavailable'
  return result.status === 'ready' && isEmpty(result.data) ? 'empty' : 'ready'
}

function Card({ card, filters, singleCampaign }: { card: CardKey; filters: HomeFilters; singleCampaign: boolean }) {
  switch (card) {
    case 'topBottom': return <TopBottom filters={filters} />
    case 'revenueCost': return <RevenueCost filters={filters} singleCampaign={singleCampaign} />
    case 'funnel': return <EngagementFunnel filters={filters} />
    case 'schedule': return <NextSevenDays filters={filters} />
    case 'journeys': return <ActiveJourneys filters={filters} />
    case 'recent': return <RecentCampaigns filters={filters} />
    case 'governance': return <GovernanceTile filters={filters} />
    case 'eReceipts': return <EReceiptsTile filters={filters} />
  }
}

const COLUMNS: Record<Exclude<LayoutRow['layout'], 'full' | 'side'>, string> = {
  '2:1': 'min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
  '1:2': 'min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
  '1:1': 'min-[1200px]:grid-cols-2',
}

/** one row: a card on its own, two side by side from 1200px (stacked below), or the design's Recent beside its side column */
function CardRow({ row, render }: { row: LayoutRow; render: (card: CardKey) => ReactNode }) {
  if (row.layout === 'side') {
    const [main, ...side] = row.cards
    return (
      <div data-row={row.name} data-layout="2:1" className="grid gap-5 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {render(main)}
        <div data-side-column className="grid min-w-0 content-start gap-4 min-[640px]:grid-cols-2 min-[1200px]:grid-cols-1">
          {side.map((card) => <Fragment key={card}>{render(card)}</Fragment>)}
        </div>
      </div>
    )
  }
  return (
    <div data-row={row.name} data-layout={row.layout} className={`grid gap-5 ${row.layout === 'full' ? '' : COLUMNS[row.layout]}`}>
      {row.cards.map((card) => <Fragment key={card}>{render(card)}</Fragment>)}
    </div>
  )
}

export function HomePage() {
  const { source, viewer } = useHomeData()
  const [filters, setFilters, clearFilters] = useHomeFilters()
  const campaigns = source.useCampaignOptions()
  const attention = source.useAttention(filters)
  const topBottom = source.useTopBottom(filters)
  const revenueCost = source.useRevenueCost(filters)
  const funnel = source.useFunnel(filters)
  const schedule = source.useSchedule(filters)
  const journeys = source.useJourneys(filters)
  const recent = source.useRecentCampaigns(filters)
  const governance = source.useGovernance(filters)
  const eReceipts = source.useEReceipts(filters)

  const tiles = createNewTiles(viewer, source.capabilities)
  const layout = homeLayout({
    filters,
    journeysOn: viewer.has('journeys'),
    eReceiptsOn: viewer.has('ereceipt'),
    availability: {
      attention: availabilityOf(attention, (data) => data.groups.length === 0),
      createNew: tiles.length ? 'ready' : 'empty',
      topBottom: availabilityOf(topBottom),
      revenueCost: availabilityOf(revenueCost),
      funnel: availabilityOf(funnel),
      schedule: availabilityOf(schedule),
      journeys: availabilityOf(journeys, (data) => data.totalJourneys === 0),
      recent: availabilityOf(recent),
      governance: availabilityOf(governance),
      eReceipts: availabilityOf(eReceipts, (data) => data === null),
    },
  })
  const render = (card: CardKey) => <Card card={card} filters={filters} singleCampaign={layout.singleCampaign} />
  const greeting = greetingFor(new Date(), viewer.timezone)
  const campaignName = layout.singleCampaign && campaigns.status === 'ready' ? campaigns.data.options.find((item) => item.id === filters.campaignIds[0])?.name : undefined

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 truncate font-display text-page-title font-semibold text-ink-900">{viewer.firstName ? `${greeting}, ${viewer.firstName}` : greeting}</h1>
        {layout.createNew && <CreateNew tiles={tiles} />}
      </div>
      {layout.attention && <NeedsAttention result={attention} />}
      <MarketingPerformance filters={filters} onChange={setFilters} onClear={clearFilters} singleCampaign={layout.singleCampaign ? campaignName ?? '1 campaign' : undefined} />
      {layout.rows.map((row) => <CardRow key={row.name} row={row} render={render} />)}
    </div>
  )
}
