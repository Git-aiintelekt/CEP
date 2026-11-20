/** The store import template: every column Import CSV reads (backend/api/v1/pos_api.py STORE_FIELDS), in the order of the store
 * form, with two sample stores to overwrite. store_number and name are required; is_active is yes or no. */
export const STORE_COLUMNS = ['store_number', 'name', 'brand', 'address1', 'address2', 'city', 'state', 'postal_code', 'country', 'district', 'phone', 'email',
  'manager', 'return_policy', 'url1', 'url2', 'url3', 'url4', 'image_url', 'is_active'] as const

const SAMPLES: Record<(typeof STORE_COLUMNS)[number], string>[] = [
  { store_number: '101', name: 'Downtown Flagship', brand: 'Sample Outfitters', address1: '250 Main Street', address2: 'Suite 100', city: 'Springfield', state: 'IL',
    postal_code: '62701', country: 'US', district: 'Central', phone: '(217) 555-0101', email: 'downtown@example.com', manager: 'Jordan Lee',
    return_policy: 'Returns within 30 days with this receipt, in original condition.', url1: 'https://www.example.com/stores/101', url2: 'https://www.example.com/returns',
    url3: '', url4: '', image_url: 'https://www.example.com/images/store-101.jpg', is_active: 'yes' },
  { store_number: '102', name: 'Riverside Mall', brand: 'Sample Outfitters', address1: '1200 River Road', address2: 'Unit 42', city: 'Springfield', state: 'IL',
    postal_code: '62704', country: 'US', district: 'West', phone: '(217) 555-0102', email: 'riverside@example.com', manager: 'Sam Patel',
    return_policy: 'Returns within 30 days with this receipt, in original condition.', url1: 'https://www.example.com/stores/102', url2: '', url3: '', url4: '',
    image_url: '', is_active: 'yes' },
]

const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/** the template as CSV text: a header row, then the samples (CRLF line ends, as spreadsheets write them) */
export function storeTemplateCsv(): string {
  return [STORE_COLUMNS.join(','), ...SAMPLES.map((row) => STORE_COLUMNS.map((column) => cell(row[column])).join(','))].join('\r\n') + '\r\n'
}
