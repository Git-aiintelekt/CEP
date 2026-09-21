/** The right-hand settings panel: which block is selected, and everything it lets you change. */
import { ChevronUp, X } from 'lucide-react'
import { createElement } from 'react'

import type { Component } from 'grapesjs'

import { iconFor } from '../layers/layerNames'
import { VIEW_ONLY_NOTE } from '../readOnly'
import { InspectorFields } from './InspectorFields'
import type { TagPickerSlot } from './fields/types'
import type { GroupedEditor } from './settings'

export const EMPTY_NOTE = 'Select a block to edit it.'
export const VIEW_ONLY_EMPTY_NOTE = 'Select a block to see its settings.'
export const DESELECT_LABEL = 'Deselect'
export const NO_SETTINGS_NOTE = 'This block has no settings yet.'

interface InspectorPanelProps {
  /** the selected block's type, or null when nothing is selected */
  kind: string | null
  name: string | null
  component: Component | null
  editor: GroupedEditor | null
  wrapper?: Component | null
  canSelectParent?: boolean
  onSelectParent?: () => void
  onDeselect?: () => void
  disabled?: boolean
  recent?: string[]
  onRecentUse?: (hex: string) => void
  onChooseImage?: () => void
  /** bumped by the editor whenever the model moved, which is what makes the values re-read */
  version?: number
  focusKey?: string | null
  /** false when the selected block offers nothing to edit */
  hasFields?: boolean
  tagPicker?: TagPickerSlot
}

/** createElement, so the glyph is not a component created during render (iconFor is a lookup, not a component). */
function KindIcon({ kind }: { kind: string }) {
  return createElement(iconFor(kind), { size: 20, strokeWidth: 1.5, className: 'shrink-0 text-ink-700', 'aria-hidden': true })
}

export function InspectorPanel({
  kind, name, component, editor, wrapper, canSelectParent = false, onSelectParent, onDeselect,
  disabled = false, recent, onRecentUse, onChooseImage, version, focusKey, hasFields = true, tagPicker,
}: InspectorPanelProps) {
  return (
    <aside aria-label="Block settings" className="flex h-full min-h-0 w-[296px] shrink-0 flex-col border-l border-line bg-surface max-[1439px]:w-[272px] max-[1199px]:w-[264px]">
      {disabled ? <p className="shrink-0 border-b border-line-subtle px-3 py-2 text-xs text-ink-700">{VIEW_ONLY_NOTE}</p> : null}
      {kind === null || component === null || editor === null ?
        <p className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-sm text-ink-700">{disabled ? VIEW_ONLY_EMPTY_NOTE : EMPTY_NOTE}</p>
      : <>
          <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
            <KindIcon kind={kind} />
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{name}</h2>
            {canSelectParent ?
              <button
                type="button"
                onClick={onSelectParent}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-800 transition-colors duration-base ease-standard hover:underline"
              >
                <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
                Select parent
              </button>
            : null}
            {onDeselect ?
              <button
                type="button"
                aria-label={DESELECT_LABEL}
                title={DESELECT_LABEL}
                onClick={onDeselect}
                className="-my-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-700 transition-colors duration-base ease-standard hover:bg-line-subtle"
              >
                <X size={16} strokeWidth={1.5} aria-hidden />
              </button>
            : null}
          </div>

          {hasFields ?
            <InspectorFields
              component={component}
              editor={editor}
              wrapper={wrapper}
              disabled={disabled}
              recent={recent}
              onRecentUse={onRecentUse}
              onChooseImage={onChooseImage}
              version={version}
              focusKey={focusKey}
              tagPicker={tagPicker}
            />
          : <p className="p-3 text-sm text-ink-700">{NO_SETTINGS_NOTE}</p>}
        </>
      }
    </aside>
  )
}
