/**
 * The receipt as the layout draws it, filled from one sample transaction. A structured layout, not compiled
 * email: it shows what each setting does, section by section.
 */
import { Barcode, ImageIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ReceiptItemsSection, ReceiptSection } from '@/lib/types'

import { inOrder } from './receiptPresets'
import { formatMoney, fulfillmentOf, showsSection, totalsRows } from './receiptRules'
import type { SampleTransaction } from './sampleReceiptData'

interface ReceiptPreviewProps {
  sections: ReceiptSection[]
  transaction: SampleTransaction
  /** the receipt inside a dimmed stand-in for the outer email */
  insideShell?: boolean
}

export function ReceiptPreview({ sections, transaction, insideShell = false }: ReceiptPreviewProps) {
  const shown = inOrder(sections).filter((section) => showsSection(section, transaction))

  const receipt = (
    <div data-testid="receipt" className="@container overflow-hidden rounded-lg border border-line bg-surface text-sm text-ink-900">
      {shown.map((section, index) => (
        <div
          key={section.key}
          data-section={section.key}
          // the one break from solid hairlines: a dashed rule marks where the money starts
          className={index === 0 ? '' : section.key === 'totals' ? 'border-t border-dashed border-ink-300' : 'border-t border-line'}
        >
          <SectionBody section={section} transaction={transaction} />
        </div>
      ))}
    </div>
  )

  if (!insideShell) return receipt
  return <EmailShell>{receipt}</EmailShell>
}

/** A stand-in for the outer design until the workspace holds both halves: a brand band, a few lines of copy. */
function EmailShell({ children }: { children: ReactNode }) {
  return (
    <div data-testid="email-shell" className="rounded-lg border border-line bg-surface-subtle p-4">
      <div aria-hidden className="flex flex-col gap-2 opacity-40">
        <div className="flex h-14 items-center rounded-sm bg-sidebar px-4 text-sm font-bold tracking-wide text-white">YOUR BRAND</div>
        <div className="flex flex-col gap-1.5 px-1 py-2">
          <div className="h-3 w-2/3 rounded-sm bg-ink-300" />
          <div className="h-2 w-full rounded-sm bg-line" />
          <div className="h-2 w-5/6 rounded-sm bg-line" />
        </div>
      </div>
      <div className="relative my-3 rounded-lg outline-2 outline-offset-4 outline-brand-600">
        <span className="absolute -top-3 left-3 z-10 rounded-sm border border-brand-600 bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800">Receipt layout</span>
        {children}
      </div>
      <div aria-hidden className="flex flex-col items-center gap-1.5 py-2 opacity-40">
        <div className="h-2 w-1/2 rounded-sm bg-line" />
        <div className="h-2 w-2/5 rounded-sm bg-line" />
      </div>
    </div>
  )
}

const TITLE = 'mb-1 text-xs font-semibold text-ink-500'

function Row({ label, value, note, strong = false }: { label: string; value: ReactNode; note?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'text-base font-semibold' : ''}`}>
      <span className={strong ? 'text-ink-900' : 'text-ink-700'}>
        {label}
        {note ? <span className="ml-1.5 rounded-sm bg-line-subtle px-1 text-xs text-ink-700">{note}</span> : null}
      </span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  )
}

function SectionBody({ section, transaction }: { section: ReceiptSection; transaction: SampleTransaction }) {
  switch (section.key) {
    case 'header': {
      const rows = [
        section.fields.order_number && ['Order', transaction.order_number],
        section.fields.order_date && ['Date', transaction.order_date],
        section.fields.store && ['Store', transaction.store],
        section.fields.receipt_id && ['Receipt ID', transaction.receipt_id],
      ].filter((row): row is [string, string] => Array.isArray(row))
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 p-4">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-500">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      )
    }
    case 'customer_fulfillment': {
      const { title, address } = fulfillmentOf(section, transaction)
      return (
        <div className="flex flex-col gap-1 p-4">
          <h3 className={TITLE}>{title}</h3>
          <p>{address ?? 'No address on this order'}</p>
          {section.delivery_estimate && transaction.delivery_estimate ? <p className="text-ink-700">{transaction.delivery_estimate}</p> : null}
        </div>
      )
    }
    case 'items':
      return <Items section={section} transaction={transaction} />
    case 'totals': {
      const rows = totalsRows(section, transaction)
      return (
        <div className="flex flex-col gap-1 p-4">
          {rows.map((row) => (
            <Row key={row.key} label={row.label} note={row.note} value={formatMoney(row.amount)} />
          ))}
          <div className={rows.length > 0 ? 'mt-1 border-t border-line pt-2' : ''}>
            <Row label="Total" value={formatMoney(transaction.total)} strong />
          </div>
          {section.savings_callout && transaction.discount ?
            <p className="mt-2 rounded-sm bg-callout-bg px-3 py-2 text-xs text-callout-text">
              You saved <span className="tabular-nums">{formatMoney(transaction.discount.amount)}</span> with {transaction.discount.code}.
            </p>
          : null}
        </div>
      )
    }
    case 'payment':
      return (
        <div className="flex flex-col gap-1 p-4">
          <h3 className={TITLE}>Payment</h3>
          {section.fields.method ? <Row label="Paid with" value={transaction.payment.masked_method} /> : null}
          {section.fields.authorization_time ? <Row label="Authorized" value={transaction.payment.authorized_at} /> : null}
          {section.fields.billing_address ? <Row label="Billing address" value={transaction.payment.billing_address} /> : null}
        </div>
      )
    case 'loyalty': {
      const loyalty = transaction.loyalty
      if (!loyalty) return null
      return (
        <div className="flex flex-col gap-1 p-4">
          <h3 className={TITLE}>Loyalty</h3>
          {section.fields.points_earned ? <Row label="Points earned" value={loyalty.points_earned.toLocaleString('en-US')} /> : null}
          {section.fields.points_balance ? <Row label="Points balance" value={loyalty.points_balance.toLocaleString('en-US')} /> : null}
          {section.fields.tier_progress ? <Row label="Tier progress" value={loyalty.tier_progress} /> : null}
        </div>
      )
    }
    case 'support':
      return (
        <div className="flex flex-col gap-3 p-4">
          <h3 className={TITLE}>Returns &amp; support</h3>
          {section.policy_text.trim() ? <p className="whitespace-pre-line text-ink-700">{section.policy_text}</p> : null}
          {section.barcode ?
            <div data-testid="return-barcode" className="flex flex-col items-center gap-1 rounded-sm border border-dashed border-ink-300 p-3 text-ink-500">
              <Barcode size={40} strokeWidth={1.25} aria-hidden />
              <span className="text-xs tabular-nums">{transaction.receipt_id}</span>
              <span className="sr-only">In-store return barcode</span>
            </div>
          : null}
        </div>
      )
  }
}

/** The image column steps aside when the receipt itself is narrow, whatever its switch says. */
function Items({ section, transaction }: { section: ReceiptItemsSection; transaction: SampleTransaction }) {
  const { columns } = section
  const cell = section.row_height === 'COMPACT' ? 'py-1.5' : 'py-3'
  const image = 'w-[52px] shrink-0 @max-[420px]:hidden'
  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-3 border-b border-line py-2 text-xs font-semibold text-ink-500">
        {columns.product_image ? <span className={image} data-column="product_image" /> : null}
        <span className="min-w-0 flex-1">Item</span>
        {columns.quantity ? <span className="w-10 text-center" data-column="quantity">Qty</span> : null}
        {columns.unit_price ? <span className="w-20 text-right" data-column="unit_price">Unit price</span> : null}
        {columns.amount ? <span className="w-20 text-right" data-column="amount">Amount</span> : null}
      </div>
      {transaction.line_items.map((item) => (
        <div key={item.sku} className={`flex items-center gap-3 border-b border-line-subtle last:border-b-0 ${cell}`}>
          {columns.product_image ?
            <span className={`${image} flex h-[52px] items-center justify-center rounded-sm bg-line-subtle text-ink-300`}>
              {item.image_url ? <img src={item.image_url} alt="" className="h-full w-full rounded-sm object-cover" /> : <ImageIcon size={18} strokeWidth={1.5} aria-hidden />}
            </span>
          : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.description}</span>
            {columns.sku ? <span className="block text-xs text-ink-500" data-column="sku">{item.sku}</span> : null}
          </span>
          {columns.quantity ? <span className="w-10 text-center tabular-nums">{item.quantity}</span> : null}
          {columns.unit_price ? <span className="w-20 text-right tabular-nums">{formatMoney(item.unit_price)}</span> : null}
          {columns.amount ? <span className="w-20 text-right tabular-nums">{formatMoney(item.amount)}</span> : null}
        </div>
      ))}
    </div>
  )
}
