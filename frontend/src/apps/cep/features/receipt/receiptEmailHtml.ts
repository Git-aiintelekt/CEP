/**
 * The receipt as email HTML: the same sections, rules and look as ReceiptPreview, written as tables with inline
 * styles. Email clients have no stylesheet of ours and many drop <style> blocks or ignore flex and grid, so every
 * colour and measurement is written onto the element it applies to — the format MJML itself compiles to.
 *
 * ReceiptPreview stays the editing view; this is its email-safe twin, and the two share receiptRules for every
 * decision about what shows.
 */
import { HIDE_MOBILE_CLASS, HIDE_MOBILE_RULE } from '@/apps/cep/features/designer/blocks/register'
import type { ReceiptItemsSection, ReceiptLayoutPreset, ReceiptSection, RegisterFieldKey, RegisterSettings } from '@/lib/types'

import { barcodeUrl } from './barcode'
import { inOrder } from './receiptPresets'
import { formatMoney, fulfillmentOf, showsSection, totalsRows } from './receiptRules'
import type { RegisterDetails, SampleTransaction } from './sampleReceiptData'
import { FOLD_RULE, ITEM_TAG, NARROW_CLASS, RECEIPT_ITEMS, WIDE_CLASS, columnValue, defaultRegisterSettings, folds, inTotalOrder, itemValue, normalRegisterSettings, registerLook } from './registerSettings'

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
  // a Code 128 of the receipt number, served by the API (a data: image would be refused by Gmail); the sent email carries the same block
  const barcode =
    section.barcode ?
      `<table ${TABLE} style="margin-top:12px;"><tr><td align="center" style="padding:12px;border:1px dashed ${COLOR.rule};border-radius:4px;text-align:center;"><img src="${escapeHtml(barcodeUrl(transaction.receipt_id))}" alt="Barcode ${escapeHtml(transaction.receipt_id)}" width="240" height="64" style="display:block;margin:0 auto 6px;width:240px;height:64px;border:0;" /><span style="font-size:12px;line-height:16px;color:${COLOR.muted};${NUMERIC}">${escapeHtml(transaction.receipt_id)}</span></td></tr></table>`
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

// ---------------------------------------------------------------- the Store Register layout (receipt_layout.render_register on the server)

const count = (value: number) => String(Number(value.toFixed(3)))

/** The register details of a sample, derived from the rest when the sample carries none. */
export function registerDetails(transaction: SampleTransaction): RegisterDetails {
  if (transaction.register) return transaction.register
  return {
    trans_number: transaction.receipt_id || transaction.order_number, register: '', store_number: transaction.store, trans_at: transaction.order_date, cashier: '',
    item_count: transaction.line_items.reduce((sum, item) => sum + Math.abs(item.quantity), 0),
    taxes: transaction.tax ? [{ label: 'Sales Tax', percent: null, amount: transaction.tax }] : [],
    tenders: transaction.payment.masked_method ? [{ label: transaction.payment.masked_method.toUpperCase(), amount: transaction.total, auth: '' }] : [],
    change_due: 0,
  }
}

/** One Totals & Tenders line as printed: its label (without the colon), its figure, and how it stands out. */
export interface RegisterTotalLine { label: string; value: string; big?: boolean; accent?: boolean }

/** The Totals & Tenders lines of a transaction, in order: hidden rows and rows with nothing for this receipt left out. */
export function registerTotalLines(transaction: SampleTransaction, settings: ReturnType<typeof normalRegisterSettings>): RegisterTotalLine[] {
  const r = registerDetails(transaction)
  const totals = settings.totals
  const out: RegisterTotalLine[] = []
  for (const row of inTotalOrder(totals.rows)) {
    if (!row.visible && row.key !== 'total') continue
    switch (row.key) {
      case 'subtotal':
        out.push({ label: row.label, value: formatMoney(transaction.subtotal) })
        break
      case 'order_discount':
        if (transaction.discount?.amount) out.push({ label: `${row.label}${transaction.discount.code ? ` (${transaction.discount.code})` : ''}`, value: `(${formatMoney(transaction.discount.amount)})` })
        break
      case 'savings': {
        const saved = transaction.line_items.reduce((sum, item) => sum + (item.discount ?? 0), 0) + (transaction.discount?.amount ?? 0)
        if (saved > 0) out.push({ label: row.label, value: formatMoney(saved), accent: true })
        break
      }
      case 'shipping':
        if (transaction.shipping) out.push({ label: row.label, value: formatMoney(transaction.shipping) })
        break
      case 'tip':
        if (transaction.tip) out.push({ label: row.label, value: formatMoney(transaction.tip) })
        break
      case 'taxes':
        for (const tax of r.taxes) out.push({ label: `${tax.label}${totals.tax_rate && tax.percent !== null ? ` (${count(tax.percent)}%)` : ''}`, value: formatMoney(tax.amount) })
        break
      case 'total':
        out.push({ label: row.label, value: formatMoney(transaction.total), big: totals.total_large })
        break
      case 'tenders':
        for (const tender of r.tenders) {
          out.push({ label: `${row.label ? `${row.label} ` : ''}${tender.label}${totals.tender_auth && tender.auth ? ` (Auth: ${tender.auth})` : ''}`, value: formatMoney(tender.amount) })
        }
        break
      case 'change':
        if (r.tenders.some((tender) => tender.label.startsWith('CASH')) || r.change_due) out.push({ label: row.label, value: formatMoney(r.change_due) })
        break
      case 'items':
        out.push({ label: row.label, value: count(r.item_count) })
        break
      case 'points_earned':
        if (transaction.loyalty) out.push({ label: row.label, value: transaction.loyalty.points_earned.toLocaleString('en-US') })
        break
      case 'points_balance':
        if (transaction.loyalty) out.push({ label: row.label, value: transaction.loyalty.points_balance.toLocaleString('en-US') })
        break
    }
  }
  return out
}

/**
 * The receipt as the register prints it: the title, the transaction's numbers in rows of three, the columns (Description
 * and Amount at least) with each line's discount and its "1 @ $19.99", the lines' sum, then the Totals & Tenders rows and
 * the footer text, in the colours, font and sizes of its Colours & Text. Without settings (a layout saved before they
 * existed) it prints exactly what it always printed.
 */
export function renderRegisterEmailHtml(transaction: SampleTransaction, settings?: RegisterSettings | null): string {
  const s = normalRegisterSettings(settings ?? defaultRegisterSettings())
  const look = registerLook(s.style)
  const r = registerDetails(transaction)
  const cell = `${look.cell}color:${look.text};`
  const strong = `${cell}font-weight:700;`
  const head = `${look.cell}color:${look.columnsText};font-weight:700;${look.upper}`
  const line = `border-bottom:1px solid ${look.line};`
  const meta = (label: string, value: string, align: 'left' | 'center' | 'right') =>
    `<td align="${align}" style="padding:1px 0;${cell}text-align:${align};"><span style="font-weight:${look.labelWeight};">${escapeHtml(label)}:</span> ${escapeHtml(value)}</td>`
  const values: Record<RegisterFieldKey, string> = {
    trans_number: r.trans_number, register: r.register, store_number: r.store_number, trans_at: r.trans_at, cashier: r.cashier, item_count: count(r.item_count),
  }
  const shown = s.fields.filter((field) => field.visible)
  const aligns = ['left', 'center', 'right'] as const
  let headerRows = ''
  for (let at = 0; at < shown.length; at += 3) headerRows += `<tr>${shown.slice(at, at + 3).map((field, index) => meta(field.label, values[field.key], aligns[index])).join('')}</tr>`
  const header = headerRows ? `<table ${TABLE}>${headerRows}</table>` : ''

  const first = s.columns[0]
  const last = s.columns[s.columns.length - 1]
  const middle = s.columns.slice(1, -1)
  const fold = folds(s)
  const wide = fold ? ` class="${WIDE_CLASS}"` : ''
  const amountWidth = middle.length ? ' width="80"' : ''
  const lines = transaction.line_items.map((item) => {
    let folded = ''
    if (fold) {
      const parts = middle.map((column) => [column.label, columnValue(column.key, item)] as const).filter(([, value]) => value).map(([label, value]) => `${label} ${value}`)
      if (parts.length) folded = `<div class="${NARROW_CLASS}" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(parts.join(' · '))}</div>`
    }
    const discount = s.under_item.discount && item.discount ? `<br /><span style="color:${look.discount};">Discount: (${escapeHtml(formatMoney(item.discount))})</span>` : ''
    const atPrice = s.under_item.quantity_at_price ? `<br /><span>${escapeHtml(count(item.quantity))} @ ${escapeHtml(formatMoney(item.unit_price))}</span>` : ''
    const codes = (['sku', 'upc'] as const).filter((key) => s.under_item[key] && item[key]).map((key) => `<br /><span>${key.toUpperCase()} ${escapeHtml(String(item[key]))}</span>`).join('')
    const cells = middle.map((column) => `<td align="center" valign="bottom" width="64"${wide} style="padding:10px 0 10px 12px;${line}${cell}text-align:center;">${escapeHtml(columnValue(column.key, item))}</td>`).join('')
    return `<tr><td valign="bottom" style="padding:10px 0;${line}${cell}">${escapeHtml(item.description)}${discount}${atPrice}${codes}${folded}</td>${cells}<td align="right" valign="bottom"${amountWidth} style="padding:10px 0 10px 16px;${line}${cell}${NUMERIC}white-space:nowrap;text-align:right;">${escapeHtml(formatMoney(item.amount))}</td></tr>`
  })
  const linesTotal = transaction.line_items.reduce((sum, item) => sum + item.amount, 0)
  const heads = middle.map((column) => `<td align="center" width="64"${wide} style="padding:0 0 0 12px;${head}text-align:center;">${escapeHtml(column.label)}</td>`).join('')
  const lastHead = middle.length ?
      `<td align="right"${amountWidth} style="padding:0 0 0 16px;${head}text-align:right;">${escapeHtml(last.label)}</td>`
    : `<td align="right" style="padding:0;${head}text-align:right;">${escapeHtml(last.label)}</td>`
  const columns = `<table ${TABLE}><tr><td style="padding:0;${head}">${escapeHtml(first.label)}</td>${heads}${lastHead}</tr></table>`
  const items = `<table ${TABLE}>${lines.join('')}<tr><td colspan="${s.columns.length}" align="right" style="padding:10px 0;${line}${strong}${NUMERIC}text-align:right;">${escapeHtml(formatMoney(linesTotal))}</td></tr></table>`

  const spread = s.totals.layout === 'SPREAD'
  const totalRow = ({ label, value, big = false, accent = false }: RegisterTotalLine) => {
    const size = big ? look.big : ''
    const tone = accent ? `color:${look.discount};` : ''
    if (spread) {
      const weight = big ? 'font-weight:700;' : ''
      return `<tr><td align="left" style="padding:2px 0;${cell}${weight}${size}${tone}text-align:left;">${escapeHtml(label)}</td><td align="right" width="96" style="padding:2px 0 2px 12px;${cell}${weight}${size}${tone}${NUMERIC}text-align:right;">${escapeHtml(value)}</td></tr>`
    }
    return `<tr><td align="right" style="padding:2px 0;${strong}${size}${tone}text-align:right;">${escapeHtml(label)}:</td><td align="right" width="96" style="padding:2px 0 2px 12px;${cell}${size}${tone}${NUMERIC}text-align:right;">${escapeHtml(value)}</td></tr>`
  }
  const totals = `<table ${TABLE}>${registerTotalLines(transaction, s).map(totalRow).join('')}</table>`

  const block = (name: string, colour: string, padding: string, inner: string) =>
    `          <table data-section="${name}" ${TABLE} style="border-radius:4px;border-collapse:separate;background-color:${colour};"><tr><td style="padding:${padding};">${inner}</td></tr></table>\n`
  const gap = `          <table ${TABLE}><tr><td style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr></table>\n`
  const title = s.title ? `<p data-section="register-title" style="margin:0 0 10px;${look.title}font-weight:700;letter-spacing:0.02em;text-align:${look.titleAlign};">${escapeHtml(s.title)}</p>` : ''
  const footer = s.footer_text ?
      gap + block('register-footer', look.card, '12px 18px', `<p style="margin:0;${cell}text-align:${s.footer_align === 'LEFT' ? 'left' : 'center'};">${escapeHtml(s.footer_text).replace(/\r?\n/g, '<br />')}</p>`)
    : ''
  return `${fold ? `<style>${FOLD_RULE}</style>\n` : ''}<table ${TABLE} align="center" style="width:100%;max-width:600px;margin:0 auto;">
  <tr>
    <td style="padding:8px 24px 24px;">
      <table ${TABLE} data-layout="register" style="border-radius:6px;border-collapse:separate;background-color:${look.band};font-family:${look.font};color:${look.text};">
        <tr><td style="padding:16px;">
${block('register-header', look.header, '14px 18px 12px', title + header)}${gap}          <table data-section="register-body" ${TABLE} style="border-radius:4px;border-collapse:separate;background-color:${look.card};"><tr><td data-section="register-columns" style="padding:8px 18px;border-radius:4px 4px 0 0;border-bottom:1px solid ${look.line};background-color:${look.columns};">${columns}</td></tr><tr><td style="padding:2px 18px 16px;"><div data-section="register-items">${items}</div><div data-section="register-totals" style="margin-top:12px;">${totals}</div></td></tr></table>
${footer}        </td></tr>
      </table>
    </td>
  </tr>
</table>`
}

/** The Item Row once per line, its {{item.*}} tags filled and escaped. */
export function renderItemRows(itemRow: string, transaction: SampleTransaction): string {
  return transaction.line_items.map((item) => itemRow.replace(ITEM_TAG, (_, key: string) => escapeHtml(itemValue(key, item)))).join('')
}

/** A Custom HTML receipt as it goes into the slot: its CSS, then its HTML with the Item Row at {{receipt_items}}. */
export function renderCustomReceiptHtml(customHtml: string, customCss: string | null | undefined, itemRow: string | null | undefined, transaction: SampleTransaction): string {
  const rows = itemRow ? renderItemRows(itemRow, transaction) : null
  const body = rows === null ? customHtml : customHtml.replace(RECEIPT_ITEMS, () => rows)
  return `${customCss ? `<style>${customCss}</style>` : ''}${body}`
}

/** What a receipt layout puts into the slot, whatever its kind: the one entry point the editors preview with. */
export interface LayoutContent {
  layout_preset: ReceiptLayoutPreset
  sections: ReceiptSection[]
  custom_html?: string | null
  custom_css?: string | null
  item_row?: string | null
  register?: RegisterSettings | null
}

export function renderLayoutEmailHtml(layout: LayoutContent, transaction: SampleTransaction): string {
  if (layout.layout_preset === 'CUSTOM_HTML' && layout.custom_html) return renderCustomReceiptHtml(layout.custom_html, layout.custom_css, layout.item_row, transaction)
  if (layout.layout_preset === 'REGISTER') return renderRegisterEmailHtml(transaction, layout.register)
  return renderReceiptEmailHtml(layout.sections, transaction)
}

/**
 * The receipt, ready for the slot: a <style> carrying only the hide-on-phones rule, then one centred 600px table.
 * The hairlines between sections are solid except the dashed one above Totals, where the money starts.
 * The Store Register preset has a layout of its own (renderRegisterEmailHtml).
 */
export function renderReceiptEmailHtml(sections: ReceiptSection[], transaction: SampleTransaction, preset?: ReceiptLayoutPreset): string {
  if (preset === 'REGISTER') return renderRegisterEmailHtml(transaction)
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
