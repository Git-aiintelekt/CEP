export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'localhost'])

/** Tenant from `<tenant>.cep.example.com`; falls back to VITE_DEFAULT_TENANT on localhost / bare hosts. */
export function tenantFromHost(hostname: string = window.location.hostname): string | null {
  const parts = hostname.split('.')
  const isIp = /^\d+(\.\d+){3}$/.test(hostname)
  if (!isIp && parts.length >= 3 && !RESERVED_SUBDOMAINS.has(parts[0])) return parts[0]
  return null
}

export const DEFAULT_TENANT: string = tenantFromHost() ?? import.meta.env.VITE_DEFAULT_TENANT ?? ''
