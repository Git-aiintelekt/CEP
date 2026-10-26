/** The Campaigns filter row: search, a dropdown button per filter, and Clear Filters while one is set. One menu is open at a time. */
import { Check, ChevronDown, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { ClearFiltersLink } from '@/components/FilterChip'
import { filterChipClass } from '@/components/filterChipStyles'
import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import { SearchField } from '@/components/SearchField'
import { Spinner } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { controlClass } from '@/components/controlStyles'
import type { CampaignFormOptions } from '@/lib/types'
import type { SingleDropdown } from '@/lib/useSingleDropdown'

import { CREATED_RANGES, rangeDates, type Filters } from './listFilters'
import { CAMPAIGN_TYPES, channelLabel, STATUS_FILTERS, typeShortLabel } from './vocabulary'

type Choice = { value: string; label: string }

const TRIGGERS: Choice[] = [{ value: '', label: 'Any' }, { value: 'journey', label: 'Journey' }, { value: 'manual', label: 'Manual' }]
const CHANNEL_CHOICES: Choice[] = ['EMAIL', 'SMS', 'MMS'].map((value) => ({ value, label: channelLabel(value) }))
const TYPE_CHOICES: Choice[] = CAMPAIGN_TYPES.map((item) => ({ value: item.value, label: typeShortLabel(item.value) }))

const labelOf = (choices: Choice[], value: string) => choices.find((choice) => choice.value === value)?.label ?? value

function FilterButton({ menus, id, label, value, width = 220, children }: { menus: SingleDropdown<string>; id: string; label: string; value?: string; width?: number; children: ReactNode }) {
  const open = menus.isOpen(id)
  return (
    <span className="relative">
      <button
        {...menus.triggerProps(id)}
        type="button"
        title={value || undefined}
        className={filterChipClass(Boolean(value))}
      >
        <span className="max-w-[200px] truncate">{value || label}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover label={label} width={width} placement="bottom-start" style={{ minWidth: 220 }} {...menus.panelProps(id)}>
          {children}
        </Popover>
      )}
    </span>
  )
}

function Option({ label, chosen, onPick, className }: { label: string; chosen: boolean; onPick: () => void; className?: string }) {
  return (
    <MenuRow
      divider={false}
      className={className}
      aria-pressed={chosen}
      title={label}
      leading={<Check size={16} strokeWidth={2} aria-hidden className={`text-link ${chosen ? '' : 'invisible'}`} />}
      onClick={onPick}
    />
  )
}

function CustomRange({ filters, onApply }: { filters: Filters; onApply: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(filters.created === 'custom' ? filters.date_from : '')
  const [to, setTo] = useState(filters.created === 'custom' ? filters.date_to : '')
  return (
    <div className="flex flex-col gap-2 border-t border-line-subtle px-3 py-3">
      <label className="text-helper font-semibold text-ink-800">From
        <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className={`${controlClass({ size: 'sm' })} mt-1 font-normal`} />
      </label>
      <label className="text-helper font-semibold text-ink-800">To
        <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={`${controlClass({ size: 'sm' })} mt-1 font-normal`} />
      </label>
      <button type="button" disabled={!from && !to} onClick={() => onApply(from, to)} className={`${buttonClass({ variant: 'primary', size: 'sm' })} mt-1`}>Apply</button>
    </div>
  )
}

interface CampaignFiltersProps {
  menus: SingleDropdown<string>
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  search: string
  onSearch: (value: string) => void
  onClear: () => void
  /** a view a link opened (Home's Needs Attention, Approvals' Open Them): shown as a set chip; pressing it lifts the view */
  linkedView?: { label: string; onRemove: () => void }
  options?: CampaignFormOptions
  zone: string
  /** Date created filters the list; the calendar's month is its own date range */
  showCreated: boolean
  fetching: boolean
}

export function CampaignFilters({ menus, filters, onChange, search, onSearch, onClear, linkedView, options, zone, showCreated, fetching }: CampaignFiltersProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const statuses = filters.status ? filters.status.split(',') : []
  const tags = options?.tags ?? []
  const owners = (options?.owners.length ?? 0) > 1 ? options!.owners : []
  const ownerName = options?.owners.find((owner) => owner.id === filters.owner)?.name
  const active = search.trim() !== '' || Object.values(filters).some(Boolean) || Boolean(linkedView)

  const pick = (patch: Partial<Filters>) => {
    onChange(patch)
    menus.close()
  }
  const toggleStatus = (value: string) => {
    const next = statuses.includes(value) ? statuses.filter((item) => item !== value) : [...statuses, value]
    onChange({ status: STATUS_FILTERS.map((item) => item.value).filter((item) => next.includes(item)).join(',') })
  }

  const statusText = statuses.length === 0 ? '' : statuses.length === 1 ? labelOf(STATUS_FILTERS, statuses[0]) : `Status · ${statuses.length}`
  const triggerText = filters.owner ? `Manual · ${ownerName ?? 'One Owner'}` : filters.triggered_by && labelOf(TRIGGERS, filters.triggered_by)
  const createdText = filters.created === 'custom' ? [filters.date_from, filters.date_to].filter(Boolean).join(' – ') : filters.created ? labelOf(CREATED_RANGES, filters.created) : ''

  return (
    <div role="search" aria-label="Filter campaigns" className="mb-4 flex flex-wrap items-center gap-2">
      <SearchField label="Search campaigns" placeholder="Search by name or code" value={search} onChange={onSearch} />
      {linkedView && (
        <button type="button" className={filterChipClass(true)} aria-label={`Remove the ${linkedView.label} view`} onClick={linkedView.onRemove}>
          {linkedView.label}<X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      )}

      <FilterButton menus={menus} id="filter-trigger" label="Triggered By" value={triggerText} width={240}>
        {TRIGGERS.map((choice) => (
          <Option key={choice.label} label={choice.value === 'manual' ? 'Manual (Any Owner)' : choice.label} chosen={filters.triggered_by === choice.value}
            onPick={() => pick({ triggered_by: choice.value, owner: '' })} />
        ))}
        {owners.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            <p aria-hidden className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-800">Owner</p>
            <div role="group" aria-label="Owner">
              {/* indented so each owner's check lines up with the option text above */}
              {owners.map((owner) => (
                <Option key={owner.id} label={owner.name} chosen={filters.owner === owner.id} className="pl-[38px]"
                  onPick={() => pick({ triggered_by: 'manual', owner: owner.id })} />
              ))}
            </div>
          </div>
        )}
      </FilterButton>

      <FilterButton menus={menus} id="filter-status" label="Status" value={statusText}>
        {STATUS_FILTERS.map((choice) => <Option key={choice.value} label={choice.label} chosen={statuses.includes(choice.value)} onPick={() => toggleStatus(choice.value)} />)}
      </FilterButton>

      <FilterButton menus={menus} id="filter-type" label="Type" value={filters.type && labelOf(TYPE_CHOICES, filters.type)}>
        {TYPE_CHOICES.map((choice) => <Option key={choice.value} label={choice.label} chosen={filters.type === choice.value} onPick={() => pick({ type: filters.type === choice.value ? '' : choice.value })} />)}
      </FilterButton>

      <FilterButton menus={menus} id="filter-channel" label="Channel" value={filters.channel && labelOf(CHANNEL_CHOICES, filters.channel)}>
        {CHANNEL_CHOICES.map((choice) => <Option key={choice.value} label={choice.label} chosen={filters.channel === choice.value} onPick={() => pick({ channel: filters.channel === choice.value ? '' : choice.value })} />)}
      </FilterButton>

      {showCreated && (
        <FilterButton menus={menus} id="filter-created" label="Date Created" value={createdText}>
          {CREATED_RANGES.map((choice) => (
            <Option key={choice.label} label={choice.label} chosen={filters.created === choice.value} onPick={() => { setCustomOpen(false); pick({ created: choice.value, ...rangeDates(choice.value, zone) }) }} />
          ))}
          <Option label="Custom Range" chosen={filters.created === 'custom'} onPick={() => setCustomOpen((value) => !value)} />
          {(customOpen || filters.created === 'custom') && (
            <CustomRange filters={filters} onApply={(from, to) => { setCustomOpen(false); pick({ created: 'custom', date_from: from, date_to: to }) }} />
          )}
        </FilterButton>
      )}

      {tags.length > 0 && (
        <FilterButton menus={menus} id="filter-tag" label="Tag" value={filters.tag}>
          <div className="max-h-80 overflow-y-auto">
            {tags.map((tag) => <Option key={tag} label={tag} chosen={filters.tag === tag} onPick={() => pick({ tag: filters.tag === tag ? '' : tag })} />)}
          </div>
        </FilterButton>
      )}

      {active && <ClearFiltersLink onClick={onClear} />}
      {fetching && <Spinner className="h-4 w-4" />}
    </div>
  )
}
