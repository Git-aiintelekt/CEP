/**
 * The selected block's settings, grouped into what it says, where it sits and how it looks.
 *
 * Values are read straight off the component on every render, so an undo, a canvas edit or another field
 * changing the same attribute all show up as soon as the editor says something moved.
 */
import { ChevronDown, ImageOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Component } from 'grapesjs'

import { Notice } from '@/components/Notice'

import { AlignField } from './fields/AlignField'
import { LengthField } from './fields/LengthField'
import { LinkField } from './fields/LinkField'
import { PaddingField } from './fields/PaddingField'
import { SelectField } from './fields/SelectField'
import { SocialNetworksField } from './fields/SocialNetworksField'
import { SwatchField } from './fields/SwatchField'
import { TextField } from './fields/TextField'
import { ToggleField } from './fields/ToggleField'
import { ColorField } from './fields/color/ColorField'
import { normaliseHex } from './fields/color/colorMath'
import { BORDER_STYLES, FONT_FAMILIES, FONT_WEIGHTS, SHADOW_OPTIONS, SOCIAL_MODES, type SelectOption } from './fields/options'
import { DEFAULT_EM_BASE } from './fields/length'
import { EMAIL_SETTINGS_NOTE, INHERITED_NOTE, type TagPickerSlot } from './fields/types'
import {
  BORDER_STYLE_KEY, CANVAS_TEXT_NOTE, HIDE_MOBILE_KEY, SHADOW_KEY, LAYOUT_NOTES, SRC_KEY, TEXT_LINK_NOTE, TEXT_ON_CANVAS, addSocialElement, blockType, fieldsFor,
  readEffective, readInherited, readSetting, type SettingField, type SettingSection,
} from './settings'
import { HIDE_MOBILE_CLASS } from '../blocks/register'
import { forbiddenIn } from '../canvas/codeChecks'
import { SOCIAL_NETWORKS } from './social'
import { createSettingBinder } from './useSettingBinding'
import { BUTTON_STYLES, DESTINATIONS, RATIOS, TREATMENTS, receiptCallout } from './receiptSettings'
import type { GroupedEditor } from './settings'

export const CHOOSE_IMAGE_LABEL = 'Choose Image'
export const NO_IMAGE_NOTE = 'No image yet'

const SECTIONS: { id: SettingSection; label: string }[] = [
  { id: 'content', label: 'Content' },
  { id: 'layout', label: 'Layout' },
  { id: 'appearance', label: 'Appearance' },
]

const SELECT_OPTIONS: Record<string, SelectOption[]> = {
  'font-family': FONT_FAMILIES,
  'font-weight': FONT_WEIGHTS,
  [BORDER_STYLE_KEY]: BORDER_STYLES,
  [SHADOW_KEY]: SHADOW_OPTIONS,
  mode: SOCIAL_MODES,
  name: SOCIAL_NETWORKS,
  destination: DESTINATIONS,
  'button-style': BUTTON_STYLES,
  treatment: TREATMENTS,
  ratio: RATIOS,
}

/** A setting whose value is a word rather than a measurement, so the switch writes that word when it is on. */
const TOGGLE_VALUES: Record<string, string> = { 'full-width': 'full-width', [HIDE_MOBILE_KEY]: HIDE_MOBILE_CLASS, tagline: 'tagline' }

export interface InspectorFieldsProps {
  component: Component
  editor: GroupedEditor
  /** the wrapper, so an inherited value can be traced to mj-attributes */
  wrapper?: Component | null
  disabled?: boolean
  recent?: string[]
  onRecentUse?: (hex: string) => void
  onChooseImage?: () => void
  /** bumped by the editor whenever the model moved, which is what makes the values re-read */
  version?: number
  /** a setting to open and focus, after an issue row sent the reader here */
  focusKey?: string | null
  /** the tag picker beside the fields that take words: a label, alt text, a link */
  tagPicker?: TagPickerSlot
}

/** Settings that take words a tag can stand in for. Never a length, a colour or a switch. */
const TAGGABLE_KEYS = new Set(['label', 'alt'])
const takesTags = (field: SettingField) => field.kind === 'link' || (field.kind === 'text' && TAGGABLE_KEYS.has(field.key))

/** The colour this text will be read against: its own background, else the nearest ancestor that sets one. */
function backgroundBehind(component: Component, wrapper?: Component | null): string {
  for (let node: Component | undefined = component; node; node = node.parent()) {
    const found = readEffective(node, 'background-color', wrapper).value
    const hex = found === null ? null : normaliseHex(found)
    if (hex !== null) return hex
  }
  return '#ffffff'
}

export function InspectorFields({
  component, editor, wrapper, disabled = false, recent = [], onRecentUse, onChooseImage, version = 0, focusKey, tagPicker,
}: InspectorFieldsProps) {
  const [closed, setClosed] = useState<Set<SettingSection>>(new Set())
  const container = useRef<HTMLDivElement>(null)

  const binder = useMemo(() => createSettingBinder(editor, component), [editor, component])
  // a drag left open when the selection moves would keep the undo stack switched off
  useEffect(() => () => binder.release(), [binder])

  const fields = fieldsFor(component)
  const type = blockType(component)
  const callout = receiptCallout(type, component)
  // a section holding the setting an issue row named is open whatever the reader collapsed earlier
  const forced = focusKey ? fields.find((field) => field.key === focusKey)?.section : undefined

  useEffect(() => {
    if (!focusKey) return
    const target = container.current?.querySelector<HTMLElement>(`[data-setting="${focusKey}"] input, [data-setting="${focusKey}"] button`)
    target?.focus()
  }, [focusKey, version])

  return (
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto">
      {callout ?
        <div className="p-3">
          <Notice layout="box">{callout}</Notice>
        </div>
      : null}
      {SECTIONS.map((section) => {
        const own = fields.filter((field) => field.section === section.id)
        const note = section.id === 'content' && TEXT_ON_CANVAS.has(type)
        const closingNote = section.id === 'layout' ? LAYOUT_NOTES[type] : undefined
        if (own.length === 0 && !note) return null

        const open = !closed.has(section.id) || section.id === forced
        return (
          <section key={section.id} className="border-t border-line first:border-t-0">
            <h3 className="m-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setClosed((was) => {
                    const next = new Set(was)
                    if (next.has(section.id)) next.delete(section.id)
                    else next.add(section.id)
                    return next
                  })
                }
                className="flex h-10 w-full items-center justify-between gap-2 px-3 text-sm font-semibold text-ink-900 transition-colors duration-base ease-standard hover:bg-line-subtle"
              >
                {section.label}
                <ChevronDown
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden
                  className={`shrink-0 text-ink-700 transition-transform duration-base ease-standard ${open ? '' : '-rotate-90'}`}
                />
              </button>
            </h3>

            {open ?
              <div className="px-3 pb-2">
                {note ?
                  <div className="py-2">
                    <p className="text-sm text-ink-700">{CANVAS_TEXT_NOTE}</p>
                    <p className="mt-1 text-xs text-ink-500">{TEXT_LINK_NOTE}</p>
                  </div>
                : null}
                {own.map((field) =>
                  field.kind === 'image' ?
                    <ImageBlock
                      key={field.key}
                      src={readSetting(component, SRC_KEY)}
                      disabled={disabled}
                      onChoose={onChooseImage}
                    />
                  : <div
                      key={field.key}
                      data-setting={field.key}
                      // A field that previews and then goes invalid never commits, which would leave the undo
                      // stack switched off. Focus leaving the field is the end of the interaction either way.
                      onBlur={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                        if (binder.previewing()) binder.release()
                      }}
                    >
                      <SettingControl
                        field={field}
                        component={component}
                        wrapper={wrapper}
                        binder={binder}
                        disabled={disabled}
                        recent={recent}
                        onRecentUse={onRecentUse}
                        tagPicker={takesTags(field) ? tagPicker : undefined}
                      />
                    </div>,
                )}
                {closingNote ? <p className="pt-1 pb-2 text-xs text-ink-500">{closingNote}</p> : null}
              </div>
            : null}
          </section>
        )
      })}
    </div>
  )
}

interface ControlProps {
  field: SettingField
  component: Component
  wrapper?: Component | null
  binder: ReturnType<typeof createSettingBinder>
  disabled: boolean
  recent: string[]
  onRecentUse?: (hex: string) => void
  tagPicker?: TagPickerSlot
}

/**
 * The px behind 1em on this block: its font size as the email would render it (MJML's 13px when nothing sets one).
 * On the Font Size field itself, em means the size the block inherits, or typing 1.5em would move its own base.
 */
function emBaseOf(component: Component, key: string, wrapper?: Component | null): number {
  const size = (key === 'font-size' ? readInherited : readEffective)(component, 'font-size', wrapper).value
  const match = size === null ? null : /^(\d+(?:\.\d+)?)px$/.exec(size.trim())
  return match ? Number(match[1]) : DEFAULT_EM_BASE
}

function SettingControl({ field, component, wrapper, binder, disabled, recent, onRecentUse, tagPicker }: ControlProps) {
  const value = readSetting(component, field.key)
  const { value: effective, source } = readEffective(component, field.key, wrapper)
  const handlers = binder.handlers(field.key)
  const emBase = field.kind === 'length' || field.kind === 'padding' ? emBaseOf(component, field.key, wrapper) : DEFAULT_EM_BASE

  const shared = {
    label: field.label,
    value,
    effective,
    disabled,
    inherited: source !== 'block',
    // mj-attributes is the designer's own head settings; anything else is what MJML falls back to
    inheritedNote: source === 'mj-attributes' || source === 'mj-all' ? EMAIL_SETTINGS_NOTE : INHERITED_NOTE,
    onCommit: handlers.onCommit,
    onCancel: handlers.onCancel,
  }

  switch (field.kind) {
    case 'color':
      return (
        <ColorField
          {...shared}
          onPreview={handlers.onPreview}
          recent={recent}
          onRecentUse={onRecentUse}
          against={field.key === 'color' ? backgroundBehind(component, wrapper) : undefined}
        />
      )
    case 'length':
      return <LengthField {...shared} onPreview={handlers.onPreview} units={field.units} min={field.min} max={field.max} step={field.step} emBase={emBase} />
    case 'padding':
      return (
        <>
          <PaddingField {...shared} onPreview={handlers.onPreview} emBase={emBase} />
          {field.help ? <p className="-mt-1 pb-1 text-xs text-ink-500">{field.help}</p> : null}
        </>
      )
    case 'align':
      return <AlignField {...shared} only={field.only} />
    case 'valign':
      return <AlignField {...shared} axis="vertical" />
    case 'toggle':
      return <ToggleField {...shared} onValue={TOGGLE_VALUES[field.key] ?? field.key} />
    case 'select':
      return (
        <>
          <SelectField {...shared} options={SELECT_OPTIONS[field.key] ?? []} required={field.required} emptyLabel={field.emptyLabel} />
          {field.help ? <p className="-mt-1 pb-1 text-xs text-ink-500">{field.help}</p> : null}
        </>
      )
    case 'swatch':
      return <SwatchField {...shared} swatches={field.swatches ?? []} />
    case 'link':
      return <LinkField {...shared} tagPicker={tagPicker} />
    // commits on leaving the field: re-parsing the markup on every keystroke would fight the typing
    case 'html':
      return <TextField {...shared} multiline placeholder={field.help} validate={forbiddenIn} />
    case 'networks':
      return <SocialNetworksField disabled={disabled} onAdd={(network) => addSocialElement(component, network)} />
    default:
      return <TextField {...shared} placeholder={field.help} tagPicker={tagPicker} multiline={field.multiline} quickTags={field.quickTags} />
  }
}

/** Only a real file name reads as one; a placeholder path ends in something like 300x120 or png. */
function fileNameOf(src: string): string {
  const last = src.split(/[?#]/)[0].split('/').pop() ?? ''
  return /\.[a-z0-9]+$/i.test(last) ? last : 'Image'
}

function ImageBlock({ src, disabled, onChoose }: { src: string | null; disabled: boolean; onChoose?: () => void }) {
  const [broken, setBroken] = useState(false)
  const name = src === null ? null : fileNameOf(src)

  return (
    <div data-setting={SRC_KEY} className="py-2">
      <div className="flex items-center gap-2">
        {src === null || broken ?
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-subtle" aria-hidden>
            <ImageOff size={20} strokeWidth={1.5} className="text-ink-300" />
          </span>
        : <img src={src} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover" onError={() => setBroken(true)} />}

        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="w-full truncate text-xs text-ink-500" title={name ?? undefined}>
            {name ?? NO_IMAGE_NOTE}
          </span>
          <button
            type="button"
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onChoose}
            className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm font-medium transition-colors duration-base ease-standard ${
              disabled ? 'border-line bg-line-subtle text-ink-300' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle'
            }`}
          >
            {CHOOSE_IMAGE_LABEL}
          </button>
        </div>
      </div>
    </div>
  )
}
