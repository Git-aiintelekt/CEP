/** Sample Results API settings (a CITY HT-like workspace with two systems reading): the /dev/settings playground and the tests. */
import type { ResultsApiSettings } from '@/lib/types'

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export const SAMPLE_RESULTS_API: ResultsApiSettings = {
  endpoint: 'https://cep.example.com/api/v1/results/', description_url: 'https://cep.example.com/api/v1/docs/', scope: 'results:read',
  keys: [
    { id: 'key-dw', name: 'Data Warehouse', key_prefix: 'cep_in_Qm81xT', allowed_ip_cidrs: ['203.0.113.0/28'], last_used_at: ago(12), expires_at: null },
    { id: 'key-icrm', name: 'iCRM', key_prefix: 'cep_in_Lk02vB', allowed_ip_cidrs: ['198.51.100.14'], last_used_at: ago(1), expires_at: new Date(Date.now() + 8.5 * 86_400_000).toISOString() },
  ],
  lists: [
    { kind: 'RESULTS_CAMPAIGNS', name: 'Campaigns', path: 'campaigns/', limit_per_minute: 60, integration_id: 'int-res-c', status: 'ACTIVE', health: 'healthy', calls_24h: 48, throttled_24h: 0,
      last_call_at: ago(12), last_read_by: 'Data Warehouse' },
    { kind: 'RESULTS_RUNS', name: 'Sends', path: 'runs/', limit_per_minute: 60, integration_id: 'int-res-r', status: 'ACTIVE', health: 'healthy', calls_24h: 24, throttled_24h: 0,
      last_call_at: ago(12), last_read_by: 'Data Warehouse' },
    { kind: 'RESULTS_MESSAGES', name: 'Recipients', path: 'messages/', limit_per_minute: 120, integration_id: 'int-res-m', status: 'ACTIVE', health: 'healthy', calls_24h: 3912, throttled_24h: 218,
      last_call_at: ago(1), last_read_by: 'iCRM' },
    { kind: 'RESULTS_SUPPRESSIONS', name: 'Suppressions', path: 'suppressions/', limit_per_minute: 60, integration_id: 'int-res-s', status: 'PAUSED', health: 'paused', calls_24h: 21, throttled_24h: 0,
      last_call_at: ago(180), last_read_by: 'iCRM' },
  ],
}

/** the first visit: no key holds the scope, nothing has read, no list has its record yet */
export const SAMPLE_RESULTS_API_FIRST_VISIT: ResultsApiSettings = {
  ...SAMPLE_RESULTS_API, keys: [],
  lists: SAMPLE_RESULTS_API.lists.map((row) => ({ ...row, integration_id: null, status: null, health: 'idle', calls_24h: 0, throttled_24h: 0, last_call_at: null, last_read_by: null })),
}
