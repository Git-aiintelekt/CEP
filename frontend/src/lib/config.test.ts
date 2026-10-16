/** Which hostnames name a workspace: `<tenant>.cep.example.com` does; an installation's own host, an IP and a bare host do not, so the login page asks. */
import { expect, test } from 'vitest'

import { tenantFromHost } from './config'

test('a workspace subdomain is the tenant; the installations’ own hosts, an IP and a bare host are not', () => {
  expect(tenantFromHost('nwa.cep.aiintelekt.com')).toBe('nwa')
  expect(tenantFromHost('NWA.cep.aiintelekt.com')).toBe('nwa')
  expect(tenantFromHost('cepdev.aiintelekt.com')).toBeNull()
  expect(tenantFromHost('ceptest.aiintelekt.com')).toBeNull()
  expect(tenantFromHost('app.aiintelekt.com')).toBeNull()
  expect(tenantFromHost('10.0.0.56')).toBeNull()
  expect(tenantFromHost('localhost')).toBeNull()
  expect(tenantFromHost('aiintelekt.com')).toBeNull()
})

test('a server reserves more of its hostnames through VITE_RESERVED_SUBDOMAINS', () => {
  const reserved = new Set(['www', 'cepstage'])
  expect(tenantFromHost('cepstage.aiintelekt.com', reserved)).toBeNull()
  expect(tenantFromHost('acme.aiintelekt.com', reserved)).toBe('acme')
})
