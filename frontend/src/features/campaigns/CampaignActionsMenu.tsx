import { EllipsisVertical } from 'lucide-react'

import { IconButton } from '@/components/Button'
import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import type { SingleDropdown } from '@/lib/useSingleDropdown'

import type { CampaignMenuItem } from './campaignMenu'

/** The ⋮ button and its menu; with nothing to offer, no button at all. */
export function CampaignActionsMenu({ menus, id, label, items, onPick }: { menus: SingleDropdown<string>; id: string; label: string; items: CampaignMenuItem[]; onPick: (item: CampaignMenuItem) => void }) {
  if (items.length === 0) return null
  const open = menus.isOpen(id)
  return (
    <span className="relative inline-block">
      <IconButton {...menus.triggerProps(id)} label={label} icon={EllipsisVertical} className={open ? 'bg-fill-subtle text-ink-900' : ''} />
      {open && (
        <Popover label={label} width={196} placement="bottom-end" className="text-left" {...menus.panelProps(id)}>
          {items.map((item) => (
            <MenuRow key={item.key} divider={false} title={item.label} leading={<item.icon size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
              onClick={() => { menus.close(); onPick(item) }} />
          ))}
        </Popover>
      )}
    </span>
  )
}
