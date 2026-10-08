/**
 * Preview & Test: the receipt against each sample transaction, as it arrives in an inbox and as it reads inside
 * the email, with the checks that decide whether it is ready. Reads only — nothing here edits the template.
 */
import { Monitor, Smartphone } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import type { PersonalizationTag, ReceiptSection } from '@/lib/types'

import { ReceiptChecksPanel } from './ReceiptChecksPanel'
import { ReceiptInboxRow } from './ReceiptInboxRow'
import { ReceiptPreview } from './ReceiptPreview'
import { computeReceiptChecks, summarizeChecks, type ReceiptCheckSummary } from './receiptChecks'
import { itemCount, receiptPreheader, receiptSubject } from './receiptInbox'
import { SAMPLE_SENDER, SAMPLE_TRANSACTIONS, type ReceiptSource, type SampleEntry, type SampleTransaction } from './sampleReceiptData'

interface PreviewTestPaneProps {
  sections: ReceiptSection[]
  hasFooterBlock: boolean
  tags: PersonalizationTag[]
  /** how many checks there are and how many fail, for the editor's own chrome to show however it likes */
  onChecksChange?: (summary: ReceiptCheckSummary) => void
  /**
   * The whole email for a sample: the compiled outer design with the receipt in its slot. Without it the pane
   * falls back to a labelled stand-in for the outer design, so it still works on its own.
   */
  renderCombinedHtml?: (transaction: SampleTransaction) => string
}

export const COMBINED_FRAME_TITLE = 'Receipt email preview'

type Device = 'desktop' | 'mobile'

/** Preview & Test's own frame widths: a desktop client's 600px column and a 375px phone. */
const FRAME_WIDTH: Record<Device, number> = { desktop: 600, mobile: 375 }

const SOURCES = [
  { value: 'POS' as const, label: 'POS' },
  { value: 'ECOMMERCE' as const, label: 'eCommerce' },
]

const DEVICES = [
  { value: 'desktop' as const, label: 'Desktop', icon: Monitor },
  { value: 'mobile' as const, label: 'Mobile', icon: Smartphone },
]

/** A short fingerprint of the email, cheap enough to take on every change. */
function fingerprint(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return `${text.length}-${hash >>> 0}`
}

const firstOf = (source: ReceiptSource) => SAMPLE_TRANSACTIONS.find((sample) => sample.source === source) as SampleEntry

export function PreviewTestPane({ sections, hasFooterBlock, tags, onChecksChange, renderCombinedHtml }: PreviewTestPaneProps) {
  const [source, setSource] = useState<ReceiptSource>('ECOMMERCE')
  const [selectedId, setSelectedId] = useState(() => firstOf('ECOMMERCE').id)
  const [device, setDevice] = useState<Device>('desktop')
  const sourceLabel = useId()

  const samples = SAMPLE_TRANSACTIONS.filter((sample) => sample.source === source)
  const selected = SAMPLE_TRANSACTIONS.find((sample) => sample.id === selectedId) ?? firstOf(source)

  const checks = useMemo(
    () => computeReceiptChecks({ transaction: selected.data, sections, hasFooterBlock, tags }),
    [selected, sections, hasFooterBlock, tags],
  )
  const combined = useMemo(() => renderCombinedHtml?.(selected.data) ?? null, [renderCombinedHtml, selected])
  const { total, failing } = summarizeChecks(checks)
  useEffect(() => {
    onChecksChange?.({ total, failing })
  }, [onChecksChange, total, failing])

  const chooseSource = (next: ReceiptSource) => {
    setSource(next)
    // the list only shows one source, so the selection moves with it
    if (selected.source !== next) setSelectedId(firstOf(next).id)
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <aside aria-label="Sample Transaction" className="flex h-full w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <h2 className="px-3 pt-3 pb-2 text-xs font-semibold text-ink-800">Sample Transaction</h2>
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          <p id={sourceLabel} className="text-xs text-ink-800">
            Data Source
          </p>
          <SegmentedControl label="Data Source" labelledBy={sourceLabel} options={SOURCES} value={source} onChange={chooseSource} stretch />
        </div>
        <div role="radiogroup" aria-label="Samples" className="flex flex-col gap-1.5 px-2 pb-3">
          {samples.map((sample) => {
            const checked = sample.id === selected.id
            return (
              <button
                key={sample.id}
                type="button"
                role="radio"
                aria-checked={checked}
                data-sample={sample.id}
                onClick={() => setSelectedId(sample.id)}
                className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-base ease-standard ${
                  checked ? 'border-brand-600 bg-brand-100' : 'border-line bg-surface hover:bg-surface-subtle'
                }`}
              >
                <span className={`text-sm font-semibold ${checked ? 'text-brand-800' : 'text-ink-900'}`}>{sample.label}</span>
                <span className="cep-num text-xs text-ink-800">
                  {itemCount(sample)} · {sample.data.payment.authorized_at}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-4">
          <SegmentedControl label="Device" options={DEVICES} value={device} onChange={setDevice} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle p-6">
          <div data-testid="preview-frame" data-device={device} className="mx-auto flex max-w-full flex-col gap-4" style={{ width: FRAME_WIDTH[device] }}>
            <ReceiptInboxRow
              senderName={SAMPLE_SENDER.name}
              senderAddress={SAMPLE_SENDER.address}
              time={selected.data.payment.authorized_at}
              subject={receiptSubject(selected)}
              preheader={receiptPreheader(selected)}
            />
            {combined === null ?
              <OuterEmailStandIn hasFooterBlock={hasFooterBlock}>
                <ReceiptPreview sections={sections} transaction={selected.data} />
              </OuterEmailStandIn>
            : /* sandbox with no allowances: no scripts, no forms, no navigation, a unique origin */
              <iframe
                // a new frame for each email: Chromium can leave a sandboxed frame unpainted when its srcdoc changes
                // while the tab holding it was hidden, which is where this pane waits until Preview & test opens
                key={fingerprint(combined)}
                title={COMBINED_FRAME_TITLE}
                sandbox=""
                srcDoc={combined}
                className="block h-[1600px] w-full rounded-lg border border-line bg-surface"
              />
            }
          </div>
        </div>
      </div>

      <aside
        aria-label="Checks"
        className="flex h-full w-[296px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface max-[1439px]:w-[272px] max-[1199px]:w-[264px]"
      >
        <ReceiptChecksPanel checks={checks} />
      </aside>
    </div>
  )
}

/**
 * The outer email, stood in for until the workspace holds the real design: the same brand band and copy lines as
 * Receipt layout's shell, here at full opacity, with a footer only when the design has one.
 */
function OuterEmailStandIn({ hasFooterBlock, children }: { hasFooterBlock: boolean; children: ReactNode }) {
  return (
    <div data-testid="outer-email" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <span className="self-start rounded-sm bg-fill-subtle px-1.5 py-0.5 text-[11px] text-ink-800">Outer design shown as a stand-in</span>
      <div aria-hidden className="flex h-14 items-center rounded-sm bg-sidebar px-4 text-sm font-semibold tracking-wide text-white">
        YOUR BRAND
      </div>
      <div aria-hidden className="flex flex-col gap-1.5 px-1">
        <div className="h-3 w-2/3 rounded-sm bg-ink-300" />
        <div className="h-2 w-full rounded-sm bg-fill-muted" />
        <div className="h-2 w-5/6 rounded-sm bg-fill-muted" />
      </div>
      {children}
      {hasFooterBlock ?
        <div data-testid="outer-footer" className="border-t border-line pt-3 text-center text-xs text-ink-800">
          <p>Your company, 1 Example Street, Your city, 00000</p>
          <p>This is a transactional receipt for a purchase you made.</p>
        </div>
      : null}
    </div>
  )
}
