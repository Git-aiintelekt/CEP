/** "Send this test now?" — the real-send warning before Run Test Publish actually fires. */
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'

interface RunTestModalProps {
  sending: boolean
  populationText: string
  channelsText: string
  governancePassed: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function RunTestModal({ sending, populationText, channelsText, governancePassed, onCancel, onConfirm }: RunTestModalProps) {
  return (
    <Modal
      title="Send This Test Now?"
      onClose={onCancel}
      badge={<IconTile tone="warning"><TriangleAlert size={20} strokeWidth={1.75} aria-hidden /></IconTile>}
      footer={
        <>
          <button type="button" className={`${buttonSecondary} flex-1`} onClick={onCancel} disabled={sending}>Cancel</button>
          <button type="button" className={`${buttonPrimary} flex-1`} onClick={onConfirm} disabled={sending}>
            {sending ? <Spinner size="sm" /> : null} Send Test
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-900">This triggers a real send through Postal and Digivize to everyone in the test population — not a simulation.</p>
        <SummaryBox>
          <SummaryRow label="Test Population">{populationText}</SummaryRow>
          <SummaryRow label="Channels">{channelsText}</SummaryRow>
          <SummaryRow label="Governance Checks">
            {governancePassed ? <span className="text-success-text">Passed</span> : <span className="text-warning-text">Not passed</span>}
          </SummaryRow>
        </SummaryBox>
      </div>
    </Modal>
  )
}

/** a 40px coloured icon tile above a pop-up's title */
export function IconTile({ tone, children }: { tone: 'warning' | 'brand'; children: ReactNode }) {
  const look = tone === 'warning' ? 'bg-warning-bg text-warning-text' : 'bg-callout-bg text-brand-600'
  return <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${look}`}>{children}</span>
}

export function SummaryBox({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line-subtle rounded-lg border border-line-subtle bg-surface-subtle px-4 text-sm">{children}</dl>
}

export function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-ink-800">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-ink-900">{children}</dd>
    </div>
  )
}
