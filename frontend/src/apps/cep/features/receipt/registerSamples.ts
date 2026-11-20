/**
 * The transactions the Store Register settings are previewed with: the in-store sale every sample set has, and a busy one
 * (ten lines, two discounts) to see five columns and the fold on a phone with a long receipt.
 */
import { DEFAULT_SAMPLE_TRANSACTION, SAMPLE_TRANSACTIONS, type SampleLineItem, type SampleTransaction } from './sampleReceiptData'

const line = (description: string, sku: string, size: string, color: string, quantity: number, unit_price: number, discount = 0): SampleLineItem => ({
  sku, description, image_url: null, quantity, unit_price, amount: Math.round(quantity * unit_price * 100) / 100, discount, upc: `0418220${sku}`, size, color,
  tax: Math.round(quantity * unit_price * 8.9) / 100, status: 'Sale',
})

const BUSY_LINES = [
  line("Men's Graphic Tee", '41822', 'L', 'Black', 2, 9.99, 2),
  line("Women's Skinny Jeans", '41823', '30', 'Indigo', 1, 24.99),
  line("Kids' Hoodie", '41824', '8', 'Red', 1, 14.99),
  line('Ankle Socks, 6-Pack', '41825', 'OS', 'White', 1, 6.99),
  line('Baseball Cap', '41826', 'OS', 'Navy', 1, 9.99, 1),
  line("Women's Sneakers", '41827', '8', 'White', 1, 29.99),
  line("Men's Joggers", '41828', 'M', 'Grey', 1, 16.99),
  line('Canvas Tote', '41829', 'OS', 'Tan', 1, 7.99),
  line("Girls' Leggings", '41830', '10', 'Pink', 2, 5.99),
  line('Phone Case', '41831', 'OS', 'Clear', 1, 8.99),
]

const BUSY_SALE: SampleTransaction = {
  ...DEFAULT_SAMPLE_TRANSACTION,
  source: 'POS',
  order_number: '#104822',
  receipt_id: '104822',
  store: 'Store 2001',
  ship_to: null,
  pickup_location: null,
  delivery_estimate: null,
  line_items: BUSY_LINES,
  subtotal: 149.88,
  discount: null,
  shipping: null,
  tax: 13.34,
  tip: null,
  total: 163.22,
  register: {
    trans_number: '104822', register: '3', store_number: '2001', trans_at: '11/21/2026 17:31', cashier: 'Tanya', item_count: 12,
    taxes: [{ label: 'Sales Tax', percent: 8.9, amount: 13.34 }], tenders: [{ label: 'VISA', amount: 163.22, auth: '04821C' }], change_due: 0,
  },
}

/** the in-store sale: the one standard sample that carries register details */
const STORE_SALE = SAMPLE_TRANSACTIONS.find((entry) => entry.data.register)?.data ?? DEFAULT_SAMPLE_TRANSACTION

export const REGISTER_SAMPLES: { key: string; label: string; data: SampleTransaction }[] = [
  { key: 'store-sale', label: 'In-store sale · 2 lines', data: STORE_SALE },
  { key: 'busy-sale', label: 'Busy sale · 10 lines', data: BUSY_SALE },
]
