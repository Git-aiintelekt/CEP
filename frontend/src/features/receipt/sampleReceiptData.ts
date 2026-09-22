/**
 * Sample transactions the receipt is previewed against: seven, each a deliberate edge case, four eCommerce and
 * three in store. A refund's money is negative; an exchange nets to exactly zero, which is not negative.
 */
export type ReceiptSource = 'POS' | 'ECOMMERCE'

export interface SampleLineItem {
  sku: string
  description: string
  image_url: string | null
  quantity: number
  unit_price: number
  amount: number
}

export interface SampleTransaction {
  source: ReceiptSource
  order_number: string
  order_date: string
  store: string
  receipt_id: string
  ship_to: string | null
  pickup_location: string | null
  delivery_estimate: string | null
  line_items: SampleLineItem[]
  subtotal: number
  discount: { code: string; amount: number } | null
  shipping: number | null
  tax: number
  tip: number | null
  total: number
  /** stored already masked: the full number never reaches the template */
  payment: { masked_method: string; authorized_at: string; billing_address: string }
  /** null for a customer who is not enrolled; an enrolled customer always carries their numbers */
  loyalty: { enrolled: true; points_earned: number; points_balance: number; tier_progress: string } | null
}

const ORDER_48219: SampleTransaction = {
  source: 'ECOMMERCE',
  order_number: '#48219',
  order_date: 'Sep 22, 2026',
  store: 'Northline online',
  receipt_id: 'RCT-48219-0922',
  ship_to: 'Jordan Lee, 12 Harbour Road, Portland, ME 04101',
  pickup_location: null,
  delivery_estimate: 'Arrives Thu, Sep 25',
  line_items: [
    { sku: 'NL-SW-2041', description: 'Merino crew sweater, navy, M', image_url: null, quantity: 1, unit_price: 89, amount: 89 },
    { sku: 'NL-SK-118', description: 'Trail socks, 3-pack', image_url: null, quantity: 2, unit_price: 14.5, amount: 29 },
    { sku: 'NL-TB-007', description: 'Canvas tote', image_url: null, quantity: 1, unit_price: 24, amount: 24 },
  ],
  subtotal: 142,
  discount: { code: 'FALL15', amount: 15 },
  shipping: 6.95,
  tax: 10.16,
  tip: null,
  total: 144.11,
  payment: { masked_method: 'Visa •••• 4242', authorized_at: 'Sep 22, 2026, 10:14 AM', billing_address: '12 Harbour Road, Portland, ME 04101' },
  loyalty: { enrolled: true, points_earned: 144, points_balance: 2380, tier_progress: '620 points to Gold' },
}

/** Collected in store: nothing is shipped, so there is no shipping amount to show whatever the settings say. */
const ORDER_48204: SampleTransaction = {
  source: 'ECOMMERCE',
  order_number: '#48204',
  order_date: 'Sep 21, 2026',
  store: 'Northline online',
  receipt_id: 'RCT-48204-0921',
  ship_to: null,
  pickup_location: 'Northline Portland, 40 Fore Street, Portland, ME 04101',
  delivery_estimate: 'Ready for pickup Sep 21, 4:00 PM',
  line_items: [{ sku: 'NL-DV-310', description: 'Down vest, olive, L', image_url: null, quantity: 1, unit_price: 120, amount: 120 }],
  subtotal: 120,
  discount: null,
  shipping: null,
  tax: 6.6,
  tip: null,
  total: 126.6,
  payment: { masked_method: 'Mastercard •••• 5100', authorized_at: 'Sep 21, 2026, 2:38 PM', billing_address: '88 Pine Street, Portland, ME 04102' },
  loyalty: { enrolled: true, points_earned: 127, points_balance: 1904, tier_progress: '1,096 points to Gold' },
}

/** Two tenders on one order, and tax owed to two states: the receipt shows the combined figure and the tender as words. */
const ORDER_48188: SampleTransaction = {
  source: 'ECOMMERCE',
  order_number: '#48188',
  order_date: 'Sep 19, 2026',
  store: 'Northline online',
  receipt_id: 'RCT-48188-0919',
  ship_to: 'Sam Rivera, 9 Elm Street, Portsmouth, NH 03801',
  pickup_location: null,
  delivery_estimate: 'Arrives Tue, Sep 23',
  line_items: [
    { sku: 'NL-RS-502', description: 'Rain shell, slate, M', image_url: null, quantity: 1, unit_price: 180, amount: 180 },
    { sku: 'NL-BN-044', description: 'Wool beanie', image_url: null, quantity: 1, unit_price: 28, amount: 28 },
  ],
  subtotal: 208,
  discount: null,
  shipping: 9.95,
  tax: 13.52,
  tip: null,
  total: 231.47,
  payment: { masked_method: 'Gift card $50.00 + Visa •••• 4242', authorized_at: 'Sep 19, 2026, 8:05 PM', billing_address: '31 Congress Street, Portland, ME 04101' },
  loyalty: null,
}

/** Money going back: every amount that is a refund is negative, so the true minus sign is what the reader sees. */
const REFUND_R1187: SampleTransaction = {
  source: 'ECOMMERCE',
  order_number: '#R-1187',
  order_date: 'Sep 20, 2026',
  store: 'Northline online',
  receipt_id: 'RCT-R1187-0920',
  ship_to: 'Jordan Lee, 12 Harbour Road, Portland, ME 04101',
  pickup_location: null,
  delivery_estimate: null,
  line_items: [{ sku: 'NL-SW-2041', description: 'Merino crew sweater, navy, M (returned)', image_url: null, quantity: 1, unit_price: 89, amount: -89 }],
  subtotal: -89,
  discount: null,
  shipping: null,
  tax: -7.12,
  tip: null,
  total: -96.12,
  payment: { masked_method: 'Refund to Visa •••• 4242', authorized_at: 'Sep 20, 2026, 11:52 AM', billing_address: '12 Harbour Road, Portland, ME 04101' },
  loyalty: { enrolled: true, points_earned: 0, points_balance: 2291, tier_progress: '709 points to Gold' },
}

const SALE_POS3391: SampleTransaction = {
  source: 'POS',
  order_number: '#POS-3391',
  order_date: 'Sep 22, 2026',
  store: 'Northline Portland',
  receipt_id: 'RCT-POS3391-0922',
  ship_to: null,
  pickup_location: null,
  delivery_estimate: null,
  line_items: [
    { sku: 'NL-SK-118', description: 'Trail socks, 3-pack', image_url: null, quantity: 1, unit_price: 14.5, amount: 14.5 },
    { sku: 'NL-WB-210', description: 'Insulated water bottle', image_url: null, quantity: 1, unit_price: 32, amount: 32 },
  ],
  subtotal: 46.5,
  discount: null,
  shipping: null,
  tax: 2.56,
  tip: null,
  total: 49.06,
  payment: { masked_method: 'Visa •••• 4242 · contactless', authorized_at: 'Sep 22, 2026, 12:41 PM', billing_address: '12 Harbour Road, Portland, ME 04101' },
  loyalty: { enrolled: true, points_earned: 49, points_balance: 2429, tier_progress: '571 points to Gold' },
}

/** Cash: nothing to mask, and the change due belongs on the receipt. */
const SALE_POS3376: SampleTransaction = {
  source: 'POS',
  order_number: '#POS-3376',
  order_date: 'Sep 21, 2026',
  store: 'Northline Portland',
  receipt_id: 'RCT-POS3376-0921',
  ship_to: null,
  pickup_location: null,
  delivery_estimate: null,
  line_items: [
    { sku: 'NL-TB-007', description: 'Canvas tote', image_url: null, quantity: 1, unit_price: 24, amount: 24 },
    { sku: 'NL-MG-015', description: 'Enamel camp mug', image_url: null, quantity: 1, unit_price: 12, amount: 12 },
  ],
  subtotal: 36,
  discount: null,
  shipping: null,
  tax: 1.98,
  tip: null,
  total: 37.98,
  payment: { masked_method: 'Cash · tendered $50.00, change due $12.02', authorized_at: 'Sep 21, 2026, 5:17 PM', billing_address: 'Not collected for cash sales' },
  loyalty: null,
}

/** A return and its replacement on one ticket: the total is exactly zero, and zero carries no minus sign. */
const EXCHANGE_POS3352: SampleTransaction = {
  source: 'POS',
  order_number: '#POS-3352',
  order_date: 'Sep 20, 2026',
  store: 'Northline Portland',
  receipt_id: 'RCT-POS3352-0920',
  ship_to: null,
  pickup_location: null,
  delivery_estimate: null,
  line_items: [
    { sku: 'NL-SW-2041', description: 'Merino crew sweater, navy, M (returned)', image_url: null, quantity: 1, unit_price: 89, amount: -89 },
    { sku: 'NL-SW-2042', description: 'Merino crew sweater, navy, L', image_url: null, quantity: 1, unit_price: 89, amount: 89 },
  ],
  subtotal: 0,
  discount: null,
  shipping: null,
  tax: 0,
  tip: null,
  total: 0,
  payment: { masked_method: 'Even exchange · no balance due', authorized_at: 'Sep 20, 2026, 3:09 PM', billing_address: '12 Harbour Road, Portland, ME 04101' },
  loyalty: { enrolled: true, points_earned: 0, points_balance: 2291, tier_progress: '709 points to Gold' },
}

export interface SampleEntry {
  id: string
  label: string
  source: ReceiptSource
  data: SampleTransaction
}

export const SAMPLE_TRANSACTIONS: SampleEntry[] = [
  { id: 'order-48219', label: 'Order #48219 — 3 items', source: 'ECOMMERCE', data: ORDER_48219 },
  { id: 'order-48204', label: 'Order #48204 — pickup', source: 'ECOMMERCE', data: ORDER_48204 },
  { id: 'order-48188', label: 'Order #48188 — split payment', source: 'ECOMMERCE', data: ORDER_48188 },
  { id: 'refund-r1187', label: 'Refund #R-1187 — negative total', source: 'ECOMMERCE', data: REFUND_R1187 },
  { id: 'sale-pos3391', label: 'Sale #POS-3391 — 2 items', source: 'POS', data: SALE_POS3391 },
  { id: 'sale-pos3376', label: 'Sale #POS-3376 — cash', source: 'POS', data: SALE_POS3376 },
  { id: 'exchange-pos3352', label: 'Exchange #POS-3352 — net zero', source: 'POS', data: EXCHANGE_POS3352 },
]

/** Who a receipt comes from, as the sample inbox shows it. */
export const SAMPLE_SENDER = { name: 'Northline', address: 'receipts@northline.example' }

export const DEFAULT_SAMPLE_TRANSACTION: SampleTransaction = SAMPLE_TRANSACTIONS[0].data
