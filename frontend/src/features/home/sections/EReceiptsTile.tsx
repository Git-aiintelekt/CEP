import { Receipt } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatNumber, formatPercent } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters } from '../data/types'

function Figure({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={`font-display leading-tight font-semibold cep-num ${muted ? 'text-xl text-ink-800' : 'text-2xl text-ink-900'}`}>{value}</span>
      <span className="text-helper text-ink-800">{label}</span>
    </div>
  )
}

/** The period's e-receipts on their own: they are transactional, so they sit outside the marketing figures. Home's Campaign and Channel filters don't apply. */
export function EReceiptsTile({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useEReceipts(filters)
  if (result.status === 'unavailable' || (result.status === 'ready' && result.data === null)) return null
  return (
    <HomeCard title="E-Receipts" icon={Receipt}
      actions={<Link to="/campaigns?type=E_RECEIPT" className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>View E-Receipts</Link>}>
      {result.status === 'loading' ? <div className="flex flex-col gap-3"><SkeletonLine width="60%" height={28} /><SkeletonLine width="60%" height={28} /></div>
        : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} title="E-receipt figures could not be loaded" />
        : (
          <>
            <div data-receipts className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Figure label="Receipts Sent" value={formatNumber(result.data!.sent)} />
              <Figure label="Open Rate" value={formatPercent(result.data!.openRate)} />
              <Figure label="Offer Clicks" value={formatNumber(result.data!.offerClicks)} />
              {result.data!.offerRevenue === null
                ? <Figure label="Revenue from Receipt Offers" value="Not Set Up" muted />
                : <Figure label="Revenue from Receipt Offers" value={formatCompactMoney(result.data!.offerRevenue)} />}
            </div>
            <p className="mt-3 text-helper text-ink-800">Excluded from marketing metrics and frequency caps.</p>
          </>
        )}
    </HomeCard>
  )
}
