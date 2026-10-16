export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/** subdomains that name an installation, never a workspace: the built-in ones, plus VITE_RESERVED_SUBDOMAINS (comma-separated) per server */
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'localhost', 'cepdev', 'ceptest',
  ...String(import.meta.env.VITE_RESERVED_SUBDOMAINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
])

/** Tenant from `<tenant>.cep.example.com`; null on an IP, a reserved subdomain or a bare host, so the login page asks for the workspace and VITE_DEFAULT_TENANT fills it in. */
export function tenantFromHost(hostname: string = window.location.hostname, reserved: ReadonlySet<string> = RESERVED_SUBDOMAINS): string | null {
  const parts = hostname.toLowerCase().split('.')
  const isIp = /^\d+(\.\d+){3}$/.test(hostname)
  if (!isIp && parts.length >= 3 && !reserved.has(parts[0])) return parts[0]
  return null
}

export const DEFAULT_TENANT: string = tenantFromHost() ?? import.meta.env.VITE_DEFAULT_TENANT ?? ''
