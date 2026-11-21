/**
 * The Store Register's settings and the Custom HTML Item Row: what can be set, the defaults, and the values a column or an
 * {{item.*}} tag shows. The server's twin is receipt_layout.py (default_register_settings, column_value, item_value).
 */
import type { RegisterColors, RegisterColumnKey, RegisterFieldKey, RegisterSettings, RegisterStyle, RegisterTheme, RegisterTotalKey, RegisterTotals } from '@/lib/types'

import { formatMoney } from './receiptRules'
import type { SampleLineItem } from './sampleReceiptData'

export const REGISTER_FIELDS: Record<RegisterFieldKey, string> = {
  trans_number: 'Trans Num', register: 'Register', store_number: 'Store', trans_at: 'Trans Dt', cashier: 'Cashier', item_count: 'Item(s) Sold',
}

/** what each header field shows, for the settings panel */
export const REGISTER_FIELD_DATA: Record<RegisterFieldKey, string> = {
  trans_number: 'Transaction number', register: 'Register', store_number: 'Store number', trans_at: 'Date and time', cashier: 'Cashier', item_count: 'Item count',
}

/** what a column can show; Description is always first and Amount always last */
export const REGISTER_COLUMNS: Record<RegisterColumnKey, string> = {
  description: 'Description', size: 'Size', color: 'Colour', quantity: 'Qty', unit_price: 'Unit Price', discount: 'Discount', tax: 'Line Tax',
  sku: 'SKU', upc: 'UPC', status: 'Status', amount: 'Amount',
}

/** the names in the Shows list, and the sample value beside each in Add Column */
export const COLUMN_DATA: Record<RegisterColumnKey, { name: string; sample: string }> = {
  description: { name: 'Description', sample: 'Trail socks, 3-pack' },
  size: { name: 'Size', sample: 'L' },
  color: { name: 'Colour', sample: 'Black' },
  quantity: { name: 'Quantity', sample: '2' },
  unit_price: { name: 'Unit Price', sample: '$9.99' },
  discount: { name: 'Discount', sample: '($2.00)' },
  tax: { name: 'Line Tax', sample: '$1.78' },
  sku: { name: 'SKU', sample: '418220' },
  upc: { name: 'UPC', sample: '041822007316' },
  status: { name: 'Status', sample: 'Sale / Return' },
  amount: { name: 'Amount', sample: '$19.98' },
}

export const MIDDLE_COLUMNS: RegisterColumnKey[] = ['size', 'color', 'quantity', 'unit_price', 'discount', 'tax', 'sku', 'upc', 'status']
export const MAX_REGISTER_COLUMNS = 5
export const MAX_REGISTER_LABEL = 40
export const MAX_REGISTER_TITLE = 60
export const MAX_REGISTER_FOOTER = 500

export const WIDE_CLASS = 'cep-rl-wide'
export const NARROW_CLASS = 'cep-rl-narrow'
/** on a phone the middle columns fold into a line under the item; clients that ignore media queries keep the columns */
export const FOLD_RULE = `@media only screen and (max-width:480px){.${WIDE_CLASS}{display:none!important;}.${NARROW_CLASS}{display:block!important;max-height:none!important;overflow:visible!important;}}`

/** The Store Register as it printed before it had settings: these print exactly that. */
export function defaultRegisterSettings(): RegisterSettings {
  return {
    title: 'YOUR RECEIPT',
    fields: (Object.keys(REGISTER_FIELDS) as RegisterFieldKey[]).map((key) => ({ key, label: REGISTER_FIELDS[key], visible: true })),
    columns: [{ key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount' }],
    under_item: { discount: true, quantity_at_price: true, sku: false, upc: false },
    footer_text: '',
    footer_align: 'CENTER',
    phone: 'FOLD',
  }
}

/** The settings as the renderer reads them: an empty label falls back to its field's, column's or row's name, the text trimmed. */
export function normalRegisterSettings(settings: RegisterSettings): RegisterSettings & { style: RegisterStyle; totals: RegisterTotals } {
  const totals = settings.totals ?? defaultRegisterTotals()
  return {
    ...settings,
    title: settings.title.trim(),
    fields: settings.fields.map((field) => ({ ...field, label: field.label.trim() || REGISTER_FIELDS[field.key] })),
    columns: settings.columns.map((column) => ({ ...column, label: column.label.trim() || REGISTER_COLUMNS[column.key] })),
    footer_text: settings.footer_text.trim(),
    style: { ...defaultRegisterStyle(), ...settings.style },
    totals: { ...totals, rows: totals.rows.map((row) => ({ ...row, label: row.key === 'tenders' ? row.label.trim() : row.label.trim() || REGISTER_TOTALS[row.key] })) },
  }
}

// ---------------------------------------------------------------- Colours & Text
/** the colours each theme prints with; `line` (the hairlines) is the theme's and not set on its own */
export const REGISTER_THEMES: Record<RegisterTheme, { label: string; colors: RegisterColors; line: string }> = {
  LILAC: { label: 'Lilac', colors: { frame: '#e4deed', cards: '#ffffff', columns: '#f5f5f5', text: '#1f1f1f', accent: '#2e9e3a' }, line: '#e6e2ed' },
  PAPER: { label: 'Paper', colors: { frame: '#f1f1f1', cards: '#ffffff', columns: '#ffffff', text: '#1f1f1f', accent: '#2e7d32' }, line: '#d9d9d9' },
  INK: { label: 'Ink', colors: { frame: '#1f1f1f', cards: '#ffffff', columns: '#1f1f1f', text: '#1f1f1f', accent: '#2e7d32' }, line: '#e0e0e0' },
  BLUE: { label: 'Blue', colors: { frame: '#dee9fc', cards: '#ffffff', columns: '#2b4dd0', text: '#1f1f1f', accent: '#2e9e3a' }, line: '#dde3f0' },
}
export const REGISTER_FONTS: Record<RegisterStyle['font'], { label: string; stack: string }> = {
  HELVETICA: { label: 'Helvetica', stack: 'Helvetica, Arial, sans-serif' },
  GEORGIA: { label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  COURIER: { label: 'Courier', stack: "'Courier New', Courier, monospace" },
}
/** the text, and TOTAL when it is a size larger: [font-size, line-height] */
const TEXT_SIZES: Record<RegisterStyle['size'], { cell: [number, number]; big: [number, number] }> = {
  S: { cell: [11, 16], big: [13, 18] }, M: { cell: [12, 18], big: [14, 20] }, L: { cell: [14, 20], big: [16, 22] },
}
const TITLE_SIZES: Record<RegisterStyle['title_size'], [number, number]> = { S: [13, 18], M: [15, 20], L: [18, 24] }
const HEX = /^#[0-9a-f]{6}$/i

export function defaultRegisterStyle(): RegisterStyle {
  return { theme: 'LILAC', colors: null, font: 'HELVETICA', size: 'M', title_size: 'M', title_align: 'CENTER', bold_labels: true, upper_headers: false }
}

/** 0 (black) to 1 (white), as WCAG weighs the channels */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** `text` on `background`, unless the two are both dark or both light: then white or near-black, whichever reads */
export function readableOn(background: string, text: string): string {
  if (!HEX.test(background) || !HEX.test(text)) return text
  const [bg, fg] = [luminance(background), luminance(text)]
  const contrast = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)
  if (contrast >= 3) return text
  return bg < 0.4 ? '#ffffff' : '#1f1f1f'
}

/** Everything the Store Register draws with, from its Colours & Text. The defaults are the values it always used. */
export function registerLook(style: RegisterStyle) {
  const theme = REGISTER_THEMES[style.theme] ?? REGISTER_THEMES.LILAC
  const colors = { ...theme.colors, ...(style.colors ?? {}) }
  const text = readableOn(colors.cards, colors.text)
  const [cellSize, cellLine] = (TEXT_SIZES[style.size] ?? TEXT_SIZES.M).cell
  const [bigSize, bigLine] = (TEXT_SIZES[style.size] ?? TEXT_SIZES.M).big
  const [titleSize, titleLine] = TITLE_SIZES[style.title_size] ?? TITLE_SIZES.M
  return {
    band: colors.frame, header: colors.cards, card: colors.cards, columns: colors.columns, line: theme.line, discount: colors.accent, text,
    columnsText: readableOn(colors.columns, text),
    font: (REGISTER_FONTS[style.font] ?? REGISTER_FONTS.HELVETICA).stack,
    cell: `font-size:${cellSize}px;line-height:${cellLine}px;`, big: `font-size:${bigSize}px;line-height:${bigLine}px;`,
    title: `font-size:${titleSize}px;line-height:${titleLine}px;`, titleAlign: style.title_align === 'LEFT' ? 'left' : 'center',
    labelWeight: style.bold_labels === false ? 400 : 700,
    upper: style.upper_headers ? 'text-transform:uppercase;letter-spacing:0.04em;' : '',
  }
}

// ---------------------------------------------------------------- Totals & Tenders
/** each row's own name, in the order printed */
export const REGISTER_TOTALS: Record<RegisterTotalKey, string> = {
  subtotal: 'Subtotal', order_discount: 'Order Discount', savings: 'You Saved', shipping: 'Shipping', tip: 'Tip', taxes: 'Taxes', total: 'TOTAL',
  tenders: 'Paid with', change: 'Cash Change', items: 'Items Sold', points_earned: 'Points Earned', points_balance: 'Points Balance',
}
export const TOTAL_ORDER = Object.keys(REGISTER_TOTALS) as RegisterTotalKey[]
/** what each row shows, for the settings panel, and a sample beside it in Add Row */
export const TOTAL_DATA: Record<RegisterTotalKey, { name: string; sample: string }> = {
  subtotal: { name: 'Subtotal', sample: '$46.50' }, order_discount: { name: "The order's discount and its code", sample: 'SAVE10 ($5.00)' },
  savings: { name: "The lines' discounts and the order's", sample: '$9.00' }, shipping: { name: 'Shipping', sample: '$6.95' }, tip: { name: 'Tip', sample: '$3.00' },
  taxes: { name: "Each tax, by its own name", sample: 'Sales Tax $2.56' }, total: { name: 'The total', sample: '$49.06' },
  tenders: { name: 'Each tender', sample: 'CREDIT-VISA $49.06' }, change: { name: 'Change for cash', sample: '$0.94' }, items: { name: 'Item count', sample: '2' },
  points_earned: { name: 'Loyalty points earned', sample: '44' }, points_balance: { name: 'Loyalty points balance', sample: '2,424' },
}
/** rows always on the receipt (they can be hidden, not removed) */
export const CORE_TOTALS: RegisterTotalKey[] = ['subtotal', 'taxes', 'total', 'tenders', 'change']

export function defaultRegisterTotals(): RegisterTotals {
  return { rows: CORE_TOTALS.map((key) => ({ key, label: key === 'taxes' ? '' : REGISTER_TOTALS[key], visible: true })), layout: 'BESIDE', tax_rate: true, tender_auth: true, total_large: true }
}

/** the rows in the order printed, whatever order they were added in */
export const inTotalOrder = (rows: RegisterTotals['rows']) => [...rows].sort((a, b) => TOTAL_ORDER.indexOf(a.key) - TOTAL_ORDER.indexOf(b.key))

export const folds = (settings: RegisterSettings | null | undefined): boolean => Boolean(settings) && settings!.phone !== 'KEEP' && settings!.columns.length > 2

/** "2", not "2.0"; 0.5 stays 0.5 — the server's f"{value:g}" */
export const countText = (value: number) => String(Number(value.toFixed(3)))

/** A Store Register cell: money as money, a discount in brackets, an empty value as nothing. */
export function columnValue(key: RegisterColumnKey, item: SampleLineItem): string {
  switch (key) {
    case 'quantity':
      return countText(item.quantity)
    case 'unit_price':
      return formatMoney(item.unit_price)
    case 'amount':
      return formatMoney(item.amount)
    case 'discount':
      return item.discount ? `(${formatMoney(item.discount)})` : ''
    case 'tax':
      return item.tax !== undefined && item.tax !== null ? formatMoney(item.tax) : ''
    case 'description':
      return item.description
    default:
      return String(item[key] ?? '')
  }
}

// ---------------------------------------------------------------- Custom HTML: the Item Row
export const ITEM_TAG = /\{\{\s*item\.([a-z_]+)\s*\}\}/g
export const RECEIPT_ITEMS = /\{\{\s*receipt_items\s*\}\}/g
export const ITEM_TAGS: { key: string; sample: string }[] = [
  { key: 'description', sample: 'Trail socks, 3-pack' }, { key: 'sku', sample: '418220' }, { key: 'upc', sample: '041822007316' },
  { key: 'size', sample: 'L' }, { key: 'color', sample: 'Black' }, { key: 'quantity', sample: '2' }, { key: 'unit_price', sample: '$9.99' },
  { key: 'discount', sample: '$2.00' }, { key: 'tax', sample: '$1.78' }, { key: 'amount', sample: '$19.98' }, { key: 'status', sample: 'Sale' },
]
const ITEM_TAG_KEYS = new Set(ITEM_TAGS.map((tag) => tag.key))

/** An {{item.*}} tag's value: a discount only when there is one, an unknown tag as nothing. */
export function itemValue(key: string, item: SampleLineItem): string {
  if (key === 'discount') return item.discount ? formatMoney(item.discount) : ''
  return ITEM_TAG_KEYS.has(key) ? columnValue(key as RegisterColumnKey, item) : ''
}

/** The starting point of a new Custom HTML layout: a table with its rows at {{receipt_items}}. */
export const STARTER_CUSTOM_HTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:Helvetica, Arial, sans-serif;font-size:14px;color:#17181c;">
  <tr><td colspan="3" style="padding:16px 0 8px;font-size:18px;font-weight:700;">Your receipt</td></tr>
  {{receipt_items}}
  <tr><td colspan="2" style="padding:12px 0;font-weight:700;">Total</td><td align="right" style="padding:12px 0;font-weight:700;">{{grand_total}}</td></tr>
</table>`

export const STARTER_ITEM_ROW = `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #e7e8ef;">{{item.description}}</td>
  <td align="center" style="padding:8px 0;border-bottom:1px solid #e7e8ef;">×{{item.quantity}}</td>
  <td align="right" style="padding:8px 0;border-bottom:1px solid #e7e8ef;">{{item.amount}}</td>
</tr>`
