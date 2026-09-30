import { ClearFiltersLink, FilterChip, MultiSelectMenu, SingleSelectMenu } from '@/components/FilterChip'

import { DEFAULT_FILTERS, type HomeFilters } from '../data/types'
import { useHomeData } from '../data/homeDataContext'
import { CHANNEL_OPTIONS, PERIOD_OPTIONS, campaignChipLabel } from '../filterLabels'

interface HomeFilterBarProps {
  filters: HomeFilters
  onChange: (next: Partial<HomeFilters>) => void
  onClear: () => void
}

/** Campaign (several), Channel (the workspace's channels) and Period. The Period chip never looks active: some period always applies. */
export function HomeFilterBar({ filters, onChange, onClear }: HomeFilterBarProps) {
  const { source, viewer } = useHomeData()
  const campaigns = source.useCampaignOptions()
  const options = campaigns.status === 'ready' ? campaigns.data.options : []
  const more = campaigns.status === 'ready' && campaigns.data.more
  const channels = CHANNEL_OPTIONS.filter((option) => option.value === 'ALL' || viewer.has(option.feature))
  const narrowed = filters.campaignIds.length > 0 || filters.channel !== DEFAULT_FILTERS.channel
  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-3">
      {campaigns.status !== 'unavailable' && (
        <FilterChip label={campaignChipLabel(filters.campaignIds, options)} active={filters.campaignIds.length > 0} menuLabel="Campaigns" menuWidth={320}>
          {({ close }) => (
            <MultiSelectMenu label="Campaigns" searchLabel="Search Campaigns" options={options.map((option) => ({ value: option.id, label: option.name }))} value={filters.campaignIds}
              note={more ? 'Showing the 200 most recently updated campaigns.' : undefined}
              onApply={(campaignIds) => { onChange({ campaignIds }); close() }} />
          )}
        </FilterChip>
      )}
      <FilterChip label={CHANNEL_OPTIONS.find((option) => option.value === filters.channel)!.label} active={filters.channel !== DEFAULT_FILTERS.channel} menuLabel="Channel" menuWidth={200}>
        {({ close }) => <SingleSelectMenu label="Channel" options={channels} value={filters.channel} onChange={(channel) => { onChange({ channel }); close() }} />}
      </FilterChip>
      <FilterChip label={PERIOD_OPTIONS.find((option) => option.value === filters.period)!.label} menuLabel="Period" menuWidth={200}>
        {({ close }) => <SingleSelectMenu label="Period" options={PERIOD_OPTIONS} value={filters.period} onChange={(period) => { onChange({ period }); close() }} />}
      </FilterChip>
      {narrowed && <ClearFiltersLink onClick={onClear} />}
    </div>
  )
}
