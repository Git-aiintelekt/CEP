/**
 * The Store Register's settings and the Custom HTML Item Row: what can be set, the defaults, and the values a column or an
 * {{item.*}} tag shows. The server's twin is receipt_layout.py (default_register_settings, column_value, item_value).
 */
import type { RegisterColumnKey, RegisterFieldKey, RegisterSettings } from '@/lib/types'

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

/** The settings as the renderer reads them: an empty label falls back to its field's or column's name, the text trimmed. */
export function normalRegisterSettings(settings: RegisterSettings): RegisterSettings {
  return {
    ...settings,
    title: settings.title.trim(),
    fields: settings.fields.map((field) => ({ ...field, label: field.label.trim() || REGISTER_FIELDS[field.key] })),
    columns: settings.columns.map((column) => ({ ...column, label: column.label.trim() || REGISTER_COLUMNS[column.key] })),
    footer_text: settings.footer_text.trim(),
  }
}

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
