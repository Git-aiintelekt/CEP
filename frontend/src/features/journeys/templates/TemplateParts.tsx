/** Small pieces shared by the template and journey cards and the preview: the category and trigger-family chips, the plum
 * "CEP Starter" tag, the step-icon strip in the canvas's category colours (an approved exception, as on the canvas)
 * and the channel icons. */
import { BadgeCheck } from 'lucide-react'

import { titleize } from '@/lib/format'
import type { JourneyGraph, JourneyTemplateCategory, JourneyTriggerFamily } from '@/lib/types'

import { CHANNEL_META } from '../channelMeta'
import { CATEGORY, ENTRY_ICON, NODE_META, type AddableType } from '../nodeDefs'
import { FAMILY_META } from '../triggerFamily'
import { CATEGORY_META, itemCategoryLabel, stepName, stepsOf } from './templateMeta'

const CHIP = 'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap'

/** What kind of journey a template is: the category tag's shape with its icon, never a dot. */
export function CategoryChip({ category }: { category: JourneyTemplateCategory }) {
  const meta = CATEGORY_META[category]
  const Icon = meta?.icon
  return (
    <span className={`${CHIP} ${meta?.chip ?? 'bg-fill-subtle text-ink-800'}`}>
      {Icon && <Icon size={12} strokeWidth={1.5} aria-hidden />}
      {itemCategoryLabel(category)}
    </span>
  )
}

/** Which trigger family a journey falls under, in the category chip's shape. */
export function FamilyChip({ family }: { family: JourneyTriggerFamily | null }) {
  const meta = family ? FAMILY_META[family] : null
  const Icon = meta?.icon
  return (
    <span className={`${CHIP} ${meta?.tile ?? 'bg-fill-subtle text-ink-800'}`}>
      {Icon && <Icon size={12} strokeWidth={1.5} aria-hidden />}
      {meta?.label ?? 'No Trigger Set'}
    </span>
  )
}

export function StarterTag() {
  return (
    <span className={`${CHIP} bg-plum-100 text-plum-800`}>
      <BadgeCheck size={12} strokeWidth={1.5} aria-hidden />
      CEP Starter
    </span>
  )
}

/** The entry trigger and then every step, as icon tiles joined by dashes: up to `max` icons (the entry's included),
 * then "+n" for the rest. The Journey Templates panel's narrower cards show five. */
export function StepStrip({ graph, max = 7 }: { graph: JourneyGraph; max?: number }) {
  const steps = stepsOf(graph)
  return <StepTypeStrip steps={steps.map((node) => ({ type: node.type, name: stepName(node) }))} max={max} />
}

/** The same strip from step types alone (a journey row carries its step types, not its graph). */
export function StepTypeStrip({ steps, max = 7 }: { steps: { type: string; name?: string }[]; max?: number }) {
  const shown = steps.slice(0, max - 1)
  const more = steps.length - shown.length
  const entry = CATEGORY.ENTRY
  const names = ['Entry', ...steps.map((step) => step.name ?? NODE_META[step.type as AddableType]?.label ?? titleize(step.type))].join(', ')
  return (
    <span role="img" aria-label={`Steps: ${names}`} className="flex min-w-0 items-center gap-0.5">
      <StripTile tile={entry.tile} icon={ENTRY_ICON} />
      {shown.map((step, index) => {
        const meta = NODE_META[step.type as AddableType]
        const category = CATEGORY[meta?.category ?? 'CONTROL']
        return (
          <span key={index} className="flex items-center gap-0.5">
            <span aria-hidden className="text-xs leading-none text-ink-300">–</span>
            <StripTile tile={category.tile} icon={meta?.icon ?? ENTRY_ICON} />
          </span>
        )
      })}
      {more > 0 && <span aria-hidden className="ml-0.5 text-xs font-semibold text-ink-800">+{more}</span>}
    </span>
  )
}

function StripTile({ tile, icon: Icon }: { tile: string; icon: typeof ENTRY_ICON }) {
  return (
    <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${tile}`}>
      <Icon size={12} strokeWidth={1.5} />
    </span>
  )
}

export function ChannelIcons({ channels }: { channels: string[] }) {
  if (channels.length === 0) return null
  const labels = channels.map((channel) => CHANNEL_META[channel]?.label ?? channel)
  return (
    <span role="img" aria-label={`Channels: ${labels.join(', ')}`} className="flex items-center gap-1.5 text-ink-800">
      {channels.map((channel) => {
        const Icon = CHANNEL_META[channel]?.icon
        return Icon ? <Icon key={channel} size={14} strokeWidth={1.5} aria-hidden /> : null
      })}
    </span>
  )
}
