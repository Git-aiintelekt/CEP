/**
 * Choose a Template: the campaign's templates in a drawer, searchable, the picked card showing the real message scaled
 * down (the Templates page's own thumbnail). Nothing changes on the page until Use Template; Cancel, the cross and Escape leave the template as it was.
 */
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Drawer } from '@/components/Drawer'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { InputGroup } from '@/components/InputGroup'
import { StatusBadge } from '@/components/StatusBadge'
import { ItemTile } from '@/apps/cep/features/templates/preview/ItemTile'
import type { Template } from '@/lib/types'

interface ChooseTemplateDrawerProps {
  /** the templates this campaign can use, already filtered by channel */
  templates: Template[]
  /** the campaign's template now ('' for none) */
  current: string
  /** the channel's name, for the empty message */
  channelName: string
  /** may make templates (template.edit): the Create New Template link */
  canCreate: boolean
  onUse: (id: string) => void
  onClose: () => void
}

export function ChooseTemplateDrawer({ templates, current, channelName, canCreate, onUse, onClose }: ChooseTemplateDrawerProps) {
  const [picked, setPicked] = useState(current)
  const [search, setSearch] = useState('')
  const currentCard = useRef<HTMLButtonElement>(null)
  // once, when the drawer opens: the campaign's current template is brought into view; later clicks never move the list
  useEffect(() => { currentCard.current?.scrollIntoView?.({ block: 'nearest' }) }, [])
  const shown = templates.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <Drawer title="Choose a Template" onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-3">
          {canCreate && <Link to="/templates/new" target="_blank" rel="noreferrer" className="mr-auto text-sm font-semibold text-brand-800 hover:underline">Create New Template</Link>}
          <span className="grow" />
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={picked === ''} onClick={() => { onUse(picked); onClose() }}>Use Template</button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        <InputGroup controlSize="md" type="search" aria-label="Search templates" placeholder="Search templates" value={search}
          onChange={(event) => setSearch(event.target.value)} start={<Search size={16} strokeWidth={1.5} aria-hidden />} />
        {templates.length === 0 ? (
          <p className="text-sm text-ink-800">No {channelName} templates yet.</p>
        ) : (
          <div role="radiogroup" aria-label="Template" className="flex flex-col gap-2">
            {shown.map((item) => {
              const selected = picked === item.id
              return (
                <button key={item.id} type="button" role="radio" aria-checked={selected} onClick={() => setPicked(item.id)}
                  ref={item.id === current ? currentCard : undefined}
                  className={`flex w-full flex-col rounded-lg border px-4 py-3 text-left transition-colors duration-fast ease-standard ${selected ? 'border-link bg-brand-100' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className={`truncate text-sm font-semibold ${selected ? 'text-brand-800' : 'text-ink-900'}`}>{item.name}</span>
                    <StatusBadge status={item.status} />
                  </span>
                  {selected && (
                    <span data-template-thumbnail className="mt-3 block w-full overflow-hidden rounded-lg border border-line bg-surface">
                      <ItemTile item={{ kind: 'template', template: item }} height={150} />
                    </span>
                  )}
                </button>
              )
            })}
            {shown.length === 0 && <p className="text-sm text-ink-800">No template matches that search.</p>}
          </div>
        )}
      </div>
    </Drawer>
  )
}
