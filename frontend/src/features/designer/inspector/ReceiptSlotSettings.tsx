/** The receipt slot's panel: the slot itself is fixed, so this says so and points to where its content is built. */
import { useId } from 'react'

import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'

import { controlClass } from './fields/controls'
import {
  CURRENT_LAYOUT_LABEL, OPEN_RECEIPT_LAYOUT_LABEL, RECEIPT_PRESETS, RECEIPT_SLOT_NOTE, type ReceiptSlotControls, type ReceiptSlotPreset,
} from './receiptSettings'

export function ReceiptSlotSettings({ preset, onPresetChange, onOpenLayout, disabled = false }: ReceiptSlotControls & { disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <Notice layout="box">{RECEIPT_SLOT_NOTE}</Notice>
      {/* reading the layout is not editing, so this stays available in view-only mode */}
      <Button size="sm" onClick={onOpenLayout} className="self-start">
        {OPEN_RECEIPT_LAYOUT_LABEL}
      </Button>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs text-ink-500">
          {CURRENT_LAYOUT_LABEL}
        </label>
        <select
          id={id}
          value={preset}
          disabled={disabled}
          onChange={(event) => onPresetChange?.(event.target.value as ReceiptSlotPreset)}
          className={controlClass(false, disabled)}
        >
          {RECEIPT_PRESETS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
