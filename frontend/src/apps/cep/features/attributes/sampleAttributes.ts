/** Sample Customer Attributes (a CITI-like workspace): the /dev/settings playground and the component tests. */
import type { AttributeSource, CustomerAttribute, TagCheck } from '@/lib/types'

export const ATTRIBUTE_SOURCES: AttributeSource[] = [
  { id: 'src-icrm', name: 'CITI iCRM', system: 'ICRM', kind: 'DATABASE', kind_label: 'Report Database', report_connection_id: 'db-1', database_name: 'CITI OFBiz', table_name: 'LOYALTY_ACCOUNT',
    id_column: 'PARTY_ID', is_active: true, last_sync_at: '2026-11-25T02:00:00Z', attribute_count: 2, row_version: 1,
    last_run: { id: 'run-1', trigger: 'NIGHTLY', trigger_label: 'Nightly', status: 'DONE', people_read: 1932410, people_matched: 1904118, values_changed: 31220, error: null,
                queued_at: '2026-11-25T02:00:00Z', started_at: '2026-11-25T02:00:01Z', finished_at: '2026-11-25T02:41:00Z', params: {} } },
  { id: 'src-shop', name: 'Shopify', system: 'SHOPIFY', kind: 'API', kind_label: 'API', report_connection_id: null, database_name: null, table_name: null, id_column: null,
    is_active: true, last_sync_at: '2026-11-25T09:14:00Z', attribute_count: 1, row_version: 1, last_run: null },
]

export const CUSTOMER_ATTRIBUTES: CustomerAttribute[] = [
  { id: 'attr-points', key: 'points_balance', label: 'Points Balance', data_type: 'NUMBER', data_type_label: 'Number', scope: 'CUSTOMER',
    source: { id: 'src-icrm', name: 'CITI iCRM', kind: 'DATABASE', system: 'ICRM', table_name: 'LOYALTY_ACCOUNT' }, source_field: 'POINTS_BALANCE', refresh: 'NIGHTLY', refresh_label: 'Nightly',
    is_pii: false, default_value: '0', is_active: true, people_with_value: 1904118, tags: ['points_balance'], row_version: 1 },
  { id: 'attr-tier', key: 'tier_end', label: 'Tier End Date', data_type: 'DATE', data_type_label: 'Date', scope: 'CUSTOMER',
    source: { id: 'src-icrm', name: 'CITI iCRM', kind: 'DATABASE', system: 'ICRM', table_name: 'LOYALTY_ACCOUNT' }, source_field: 'TIER_END_DATE', refresh: 'NIGHTLY', refresh_label: 'Nightly',
    is_pii: false, default_value: null, is_active: true, people_with_value: 1904118, tags: ['tier_expiry'], row_version: 1 },
  { id: 'attr-order', key: 'last_online_order', label: 'Last Online Order', data_type: 'DATE', data_type_label: 'Date', scope: 'CUSTOMER',
    source: { id: 'src-shop', name: 'Shopify', kind: 'API', system: 'SHOPIFY', table_name: null }, source_field: 'last_order', refresh: 'ON_CHANGE', refresh_label: 'On Change',
    is_pii: false, default_value: null, is_active: true, people_with_value: 214903, tags: [], row_version: 1 },
]

export const TAG_CHECK: TagCheck = {
  template: { id: 't-promo', name: 'Black Friday Reminder' }, people: 12480,
  tags: [
    { key: 'first_name', label: 'First Name', default: 'there', with_value: 12480, missing: 0, from: 'CUSTOMER', by_source: { LIST: 0, ATTRIBUTE: 0, CUSTOMER: 12480 }, attribute: null },
    { key: 'store_name', label: 'Store Name', default: 'your nearest store', with_value: 12476, missing: 4, from: 'LIST', by_source: { LIST: 12476, ATTRIBUTE: 0, CUSTOMER: 0 }, attribute: null },
    { key: 'points_balance', label: 'Points Balance', default: 'your', with_value: 0, missing: 12480, from: null, by_source: { LIST: 0, ATTRIBUTE: 0, CUSTOMER: 0 }, attribute: 'points_balance' },
  ],
  short: 2,
  fillable: [{ tag: 'store_name', attribute: null }, { tag: 'points_balance', attribute: 'points_balance' }],
  attributes: [{ key: 'points_balance', label: 'Points Balance', source: 'CITI iCRM', field: 'POINTS_BALANCE' }],
}

