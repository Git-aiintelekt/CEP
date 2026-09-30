/**
 * Development only (/dev/fields, not registered in production builds): every inspector field in every state,
 * in a column the width of the real panel. Plain local state, no editor and no backend.
 */
import { useState } from 'react'

import { AlignField } from '@/features/designer/inspector/fields/AlignField'
import { ColorField } from '@/features/designer/inspector/fields/color/ColorField'
import { LengthField } from '@/features/designer/inspector/fields/LengthField'
import { LinkField } from '@/features/designer/inspector/fields/LinkField'
import { FONT_WEIGHTS } from '@/features/designer/inspector/fields/options'
import { PaddingField } from '@/features/designer/inspector/fields/PaddingField'
import { SelectField } from '@/features/designer/inspector/fields/SelectField'
import { TextField } from '@/features/designer/inspector/fields/TextField'
import { ToggleField } from '@/features/designer/inspector/fields/ToggleField'

interface Counts {
  preview: number
  commit: number
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="shrink-0">
      <h2 className="mb-2 text-sm font-semibold text-ink-900">{title}</h2>
      <div className="w-[296px] rounded-lg border border-line bg-surface p-3">{children}</div>
    </section>
  )
}

export default function DevFields() {
  const [length, setLength] = useState<string | null>('15px')
  const [padding, setPadding] = useState<string | null>('10px 20px')
  const [align, setAlign] = useState<string | null>('center')
  const [vertical, setVertical] = useState<string | null>(null)
  const [full, setFull] = useState<string | null>(null)
  const [alt, setAlt] = useState<string | null>('Our logo')
  const [href, setHref] = useState<string | null>('https://example.com')
  const [weight, setWeight] = useState<string | null>('700')
  const [color, setColor] = useState<string | null>('#2753e4')
  const [openColor, setOpenColor] = useState<string | null>('#16a34a')
  const [recent, setRecent] = useState<string[]>(['#0f172a', '#dc2626'])
  const [counts, setCounts] = useState<Counts>({ preview: 0, commit: 0 })

  const count = (which: keyof Counts) => setCounts((was) => ({ ...was, [which]: was[which] + 1 }))
  const remember = (hex: string) => setRecent((was) => [hex, ...was.filter((item) => item !== hex)].slice(0, 8))

  /** Wired to the drag counters, so a real pointer drag can be checked against them on screen. */
  const counted = <T,>(set: (value: T) => void) => ({
    onPreview: () => count('preview'),
    onCommit: (value: T) => {
      count('commit')
      set(value)
    },
  })

  return (
    <div className="min-h-screen bg-canvas p-8">
      <h1 className="text-section-title mb-1 font-semibold text-ink-900">Inspector Fields</h1>
      <p className="mb-6 text-sm text-ink-800">
        Every field at the width of the real panel. Drag the colour square: previews{' '}
        <strong className="cep-num font-semibold text-ink-900">{counts.preview}</strong>, commits{' '}
        <strong className="cep-num font-semibold text-ink-900">{counts.commit}</strong>.{' '}
        <button
          type="button"
          onClick={() => setCounts({ preview: 0, commit: 0 })}
          className="h-8 rounded-sm px-2 text-xs font-medium text-brand-800 hover:bg-fill-subtle"
        >
          Reset Counters
        </button>
      </p>

      <div className="flex flex-wrap items-start gap-6">
        <Column title="Set, with Reset">
          <LengthField label="Font Size" value={length} min={0} max={200} {...counted(setLength)} />
          <PaddingField label="Padding" value={padding} {...counted(setPadding)} />
          <AlignField label="Alignment" value={align} {...counted(setAlign)} />
          <AlignField label="Vertical Alignment" value={vertical} axis="vertical" effective="top" inherited {...counted(setVertical)} />
          <ToggleField label="Full Width" value={full} onValue="full-width" {...counted(setFull)} />
          <TextField label="Alt Text" value={alt} {...counted(setAlt)} />
          <LinkField label="Link" value={href} {...counted(setHref)} />
          <SelectField label="Font Weight" value={weight} options={FONT_WEIGHTS} {...counted(setWeight)} />
          <ColorField
            label="Text Color" value={color} against="#ffffff" recent={recent} onRecentUse={remember}
            {...counted(setColor)}
          />
        </Column>

        <Column title="Empty, Inheriting from the Email">
          <LengthField label="Font Size" value={null} effective="15px" inherited onCommit={() => {}} />
          <PaddingField label="Padding" value={null} effective="10px 25px" inherited onCommit={() => {}} />
          <AlignField label="Alignment" value={null} effective="left" inherited onCommit={() => {}} />
          <ToggleField label="Full Width" value={null} onValue="full-width" onCommit={() => {}} />
          <TextField label="Alt Text" value={null} effective="" onCommit={() => {}} />
          <LinkField label="Link" value={null} onCommit={() => {}} />
          <SelectField label="Font Weight" value={null} effective="400" options={FONT_WEIGHTS} inherited onCommit={() => {}} />
          <ColorField label="Text Color" value={null} effective="#334155" inherited onCommit={() => {}} />
        </Column>

        <Column title="Disabled">
          <LengthField label="Font Size" value="15px" disabled onCommit={() => {}} />
          <PaddingField label="Padding" value="10px 20px" disabled onCommit={() => {}} />
          <AlignField label="Alignment" value="center" disabled onCommit={() => {}} />
          <ToggleField label="Full Width" value="full-width" onValue="full-width" disabled onCommit={() => {}} />
          <TextField label="Alt Text" value="Our logo" disabled onCommit={() => {}} />
          <LinkField label="Link" value="https://example.com" disabled onCommit={() => {}} />
          <SelectField label="Font Weight" value="700" options={FONT_WEIGHTS} disabled onCommit={() => {}} />
          <ColorField label="Text Color" value="#2753e4" disabled onCommit={() => {}} />
        </Column>

        <Column title="Invalid, and a Low-Contrast Colour">
          <p className="mb-2 text-xs text-ink-800">Type 2em in the length, javascript: in the link.</p>
          <LengthField label="Font Size" value={null} min={0} onCommit={() => {}} />
          <PaddingField label="Padding" value={null} onCommit={() => {}} />
          <LinkField label="Link" value={null} onCommit={() => {}} />
          <ColorField label="Text Color" value="#808080" against="#ffffff" onCommit={() => {}} />
        </Column>

        <Column title="Colour Picker Open">
          <ColorField
            label="Background Color" value={openColor} recent={recent} onRecentUse={remember}
            onPreview={() => count('preview')}
            onCommit={(value) => {
              count('commit')
              setOpenColor(value)
            }}
          />
          <p className="mt-2 text-xs text-ink-800">Click the swatch to open the picker.</p>
        </Column>
      </div>
    </div>
  )
}
