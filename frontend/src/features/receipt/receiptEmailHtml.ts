/**
 * The receipt as email HTML: the same sections, rules and look as ReceiptPreview, written as tables with inline
 * styles. Email clients have no stylesheet of ours and many drop <style> blocks or ignore flex and grid, so every
 * colour and measurement is written onto the element it applies to — the format MJML itself compiles to.
 *
 * ReceiptPreview stays the editing view; this is its email-safe twin, and the two share receiptRules for every
 * decision about what shows.
 */
import { HIDE_MOBILE_CLASS, HIDE_MOBILE_RULE } from '@/features/designer/blocks/register'
import type { ReceiptItemsSection, ReceiptSection } from '@/lib/types'

import { inOrder } from './receiptPresets'
import { formatMoney, fulfillmentOf, showsSection, totalsRows } from './receiptRules'
import type { SampleTransaction } from './sampleReceiptData'

/** The values ReceiptPreview draws with (the app's tokens in index.css), written out because email has no variables. */
const COLOR = {
  text: '#17181c',
  muted: '#6b6f7b',
  line: '#e7e8ef',
  subtle: '#eeeff5',
  /** the dashed rule above Totals: ink-300, as on screen */
  rule: '#9ea2ad',
  surface: '#ffffff',
  /** the savings note: the callout tokens, as ReceiptPreview draws it */
  calloutBg: '#eef2fe',
  calloutText: '#312e7c',
} as const

/**
 * Hides the image column on phones. The fragment carries it in its own <style>, and the combined email repeats it
 * in <head>, since some clients drop a <style> anywhere else.
 */
export const RECEIPT_HIDE_MOBILE_STYLE = HIDE_MOBILE_RULE

const FONT = 'Helvetica, Arial, sans-serif'
const NUMERIC = 'font-variant-numeric:tabular-nums;'
const TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Every value comes from a record or an author, never from us, so all of it is escaped. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character])
}

function title(text: string): string {
  return `<p style="margin:0 0 4px;font-size:12px;line-height:16px;font-weight:600;color:${COLOR.muted};">${escapeHtml(text)}</p>`
}

/** A label on the left, its value on the right; the right alignment is what keeps figures in columns everywhere. */
function row(label: string, value: string, { note, strong = false, numeric = false }: { note?: string; strong?: boolean; numeric?: boolean } = {}): string {
  const size = strong ? 'font-size:16px;line-height:24px;font-weight:600;' : 'font-size:14px;line-height:20px;'
  const chip = note ? ` <span style="padding:0 4px;border-radius:4px;background-color:${COLOR.subtle};font-size:12px;color:${COLOR.muted};">${escapeHtml(note)}</span>` : ''
  return `<tr>
    <td style="padding:2px 0;${size}color:${strong ? COLOR.text : COLOR.muted};">${escapeHtml(label)}${chip}</td>
    <td align="right" style="padding:2px 0 2px 16px;${size}${numeric ? NUMERIC : ''}color:${COLOR.text};text-align:right;">${escapeHtml(value)}</td>
  </tr>`
}

function rows(body: string): string {
  return `<table ${TABLE}>${body}</table>`
}

function header(section: Extract<ReceiptSection, { key: 'header' }>, transaction: SampleTransaction): string {
  const fields: [boolean, string, string][] = [
    [section.fields.order_number, 'Order', transaction.order_number],
    [section.fields.order_date, 'Date', transaction.order_date],
    [section.fields.store, 'Store', transaction.store],
    [section.fields.receipt_id, 'Receipt ID', transaction.receipt_id],
  ]
  return rows(fields.filter(([on]) => on).map(([, label, value]) => row(label, value)).join(''))
}

function fulfillment(section: Extract<ReceiptSection, { key: 'customer_fulfillment' }>, transaction: SampleTransaction): string {
  const { title: heading, address } = fulfillmentOf(section, transaction)
  const estimate =
    section.delivery_estimate && transaction.delivery_estimate ?
      `<p style="margin:4px 0 0;font-size:14px;line-height:20px;color:${COLOR.muted};">${escapeHtml(transaction.delivery_estimate)}</p>`
    : ''
  return `${title(heading)}<p style="margin:0;font-size:14px;line-height:20px;color:${COLOR.text};">${escapeHtml(address ?? 'No address on this order')}</p>${estimate}`
}

/**
 * The image column carries the hide-on-phones class: a phone's narrow column has no room for it. The class is
 * a hook for the media query in the fragment's <style>, never a style of its own.
 */
function items(section: ReceiptItemsSection, transaction: SampleTransaction): string {
  const { columns } = section
  const pad = section.row_height === 'COMPACT' ? '6px' : '12px'
  const head = (label: string, width: string, align: 'left' | 'center' | 'right') =>
    `<td width="${width}" align="${align}" style="padding:8px 0 8px 12px;border-bottom:1px solid ${COLOR.line};font-size:12px;line-height:16px;font-weight:600;color:${COLOR.muted};text-align:${align};">${label}</td>`

  const headings = [
    columns.product_image ? `<td class="${HIDE_MOBILE_CLASS}" width="64" style="padding:8px 0;border-bottom:1px solid ${COLOR.line};"></td>` : '',
    `<td style="padding:8px 0;border-bottom:1px solid ${COLOR.line};font-size:12px;line-height:16px;font-weight:600;color:${COLOR.muted};">Item</td>`,
    columns.quantity ? head('Qty', '36', 'center') : '',
    columns.unit_price ? head('Unit price', '76', 'right') : '',
    columns.amount ? head('Amount', '76', 'right') : '',
  ].join('')

  const lines = transaction.line_items.map((item, index) => {
    const border = index === transaction.line_items.length - 1 ? '' : `border-bottom:1px solid ${COLOR.subtle};`
    const cell = (align: 'center' | 'right', value: string) =>
      `<td align="${align}" style="padding:${pad} 0 ${pad} 12px;${border}font-size:14px;line-height:20px;${NUMERIC}white-space:nowrap;color:${COLOR.text};text-align:${align};">${escapeHtml(value)}</td>`
    const image =
      item.image_url ?
        `<img src="${escapeHtml(item.image_url)}" alt="" width="52" height="52" style="display:block;width:52px;height:52px;border:0;border-radius:4px;" />`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="52" height="52" style="width:52px;height:52px;border-radius:4px;background-color:${COLOR.subtle};"></td></tr></table>`
    const sku = columns.sku ? `<br /><span style="font-size:12px;line-height:16px;color:${COLOR.muted};">${escapeHtml(item.sku)}</span>` : ''
    return `<tr>
      ${columns.product_image ? `<td class="${HIDE_MOBILE_CLASS}" width="64" valign="middle" style="padding:${pad} 12px ${pad} 0;${border}">${image}</td>` : ''}
      <td valign="middle" style="padding:${pad} 0;${border}font-size:14px;line-height:20px;color:${COLOR.text};">${escapeHtml(item.description)}${sku}</td>
      ${columns.quantity ? cell('center', String(item.quantity)) : ''}
      ${columns.unit_price ? cell('right', formatMoney(item.unit_price)) : ''}
      ${columns.amount ? cell('right', formatMoney(item.amount)) : ''}
    </tr>`
  })

  return `<table ${TABLE}><tr>${headings}</tr>${lines.join('')}</table>`
}

function totals(section: Extract<ReceiptSection, { key: 'totals' }>, transaction: SampleTransaction): string {
  const listed = totalsRows(section, transaction)
  const body = listed.map((item) => row(item.label, formatMoney(item.amount), { note: item.note, numeric: true })).join('')
  const rule = listed.length > 0 ? `<tr><td colspan="2" style="padding-top:4px;border-bottom:1px solid ${COLOR.line};font-size:0;line-height:0;">&nbsp;</td></tr><tr><td colspan="2" style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>` : ''
  const savings =
    section.savings_callout && transaction.discount ?
      `<table ${TABLE} style="margin-top:8px;"><tr><td style="padding:8px 12px;border-radius:4px;background-color:${COLOR.calloutBg};font-size:12px;line-height:16px;color:${COLOR.calloutText};">You saved <span style="${NUMERIC}">${formatMoney(transaction.discount.amount)}</span> with ${escapeHtml(transaction.discount.code)}.</td></tr></table>`
    : ''
  return `${rows(`${body}${rule}${row('Total', formatMoney(transaction.total), { strong: true, numeric: true })}`)}${savings}`
}

function payment(section: Extract<ReceiptSection, { key: 'payment' }>, transaction: SampleTransaction): string {
  const { fields } = section
  return `${title('Payment')}${rows(
    [
      fields.method ? row('Paid with', transaction.payment.masked_method) : '',
      fields.authorization_time ? row('Authorized', transaction.payment.authorized_at) : '',
      fields.billing_address ? row('Billing address', transaction.payment.billing_address) : '',
    ].join(''),
  )}`
}

function loyalty(section: Extract<ReceiptSection, { key: 'loyalty' }>, transaction: SampleTransaction): string {
  const points = transaction.loyalty
  if (!points) return ''
  const { fields } = section
  return `${title('Loyalty')}${rows(
    [
      fields.points_earned ? row('Points earned', points.points_earned.toLocaleString('en-US'), { numeric: true }) : '',
      fields.points_balance ? row('Points balance', points.points_balance.toLocaleString('en-US'), { numeric: true }) : '',
      fields.tier_progress ? row('Tier progress', points.tier_progress) : '',
    ].join(''),
  )}`
}

function support(section: Extract<ReceiptSection, { key: 'support' }>, transaction: SampleTransaction): string {
  const policy = section.policy_text.trim() ?
      `<p style="margin:4px 0 0;font-size:14px;line-height:20px;color:${COLOR.muted};">${escapeHtml(section.policy_text).replace(/\r?\n/g, '<br />')}</p>`
    : ''
  const barcode =
    section.barcode ?
      `<table ${TABLE} style="margin-top:12px;"><tr><td align="center" style="padding:12px;border:1px dashed ${COLOR.rule};border-radius:4px;font-size:12px;line-height:16px;color:${COLOR.muted};text-align:center;">In-store return barcode<br /><span style="${NUMERIC}">${escapeHtml(transaction.receipt_id)}</span></td></tr></table>`
    : ''
  return `${title('Returns & support')}${policy}${barcode}`
}

function body(section: ReceiptSection, transaction: SampleTransaction): string {
  switch (section.key) {
    case 'header':
      return header(section, transaction)
    case 'customer_fulfillment':
      return fulfillment(section, transaction)
    case 'items':
      return items(section, transaction)
    case 'totals':
      return totals(section, transaction)
    case 'payment':
      return payment(section, transaction)
    case 'loyalty':
      return loyalty(section, transaction)
    case 'support':
      return support(section, transaction)
  }
}

/**
 * The receipt, ready for the slot: a <style> carrying only the hide-on-phones rule, then one centred 600px table.
 * The hairlines between sections are solid except the dashed one above Totals, where the money starts.
 */
export function renderReceiptEmailHtml(sections: ReceiptSection[], transaction: SampleTransaction): string {
  const shown = inOrder(sections).filter((section) => showsSection(section, transaction))
  const cells = shown.map((section, index) => {
    const divider =
      index === 0 ? ''
      : section.key === 'totals' ? `border-top:1px dashed ${COLOR.rule};`
      : `border-top:1px solid ${COLOR.line};`
    const padding = section.key === 'items' ? '8px 16px' : '16px'
    return `<tr><td data-section="${section.key}" style="padding:${padding};${divider}">${body(section, transaction)}</td></tr>`
  })

  return `<style>${RECEIPT_HIDE_MOBILE_STYLE}</style>
<table ${TABLE} align="center" style="width:100%;max-width:600px;margin:0 auto;background-color:${COLOR.surface};">
  <tr>
    <td style="padding:8px 24px 24px;">
      <table ${TABLE} style="border:1px solid ${COLOR.line};border-radius:8px;border-collapse:separate;background-color:${COLOR.surface};font-family:${FONT};color:${COLOR.text};">
        ${cells.join('\n        ')}
      </table>
    </td>
  </tr>
</table>`
}
