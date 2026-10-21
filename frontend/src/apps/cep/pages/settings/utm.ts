/** UTM tracking on the client: the settings' query key, parameter names, the example on Settings → UTM Tracking, and how a text's
 * links are counted once they become short links (the server's apps/delivery/utm.py has the real rules). */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { UtmRule, UtmSettings } from '@/lib/types'

export const UTM_KEY = ['workspace', 'utm']

export const PARAM_LABEL: Record<string, string> = {
  utm_source: 'Session source · required', utm_medium: 'Session medium', utm_campaign: 'Session campaign', utm_id: 'Session campaign ID',
  utm_content: 'Session manual ad content', utm_term: 'Session manual term', utm_source_platform: 'Session source platform',
  utm_creative_format: 'Session manual creative format', utm_marketing_tactic: 'Session manual marketing tactic',
}

export const GA4_PARAMS = new Set(['utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic'])

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
}

const EXAMPLE: Record<string, string> = { campaign_name: 'Fall Launch: New Arrivals', campaign_code: 'CMP-2026-0042', campaign_category: 'promotional',
  channel: 'email', link_label: 'hero-cta', link_label_variant: 'hero-cta-b' }

/** what each parameter goes out as for the example link: the hero button of "Fall Launch: New Arrivals", variant B */
export function exampleValues(params: Record<string, UtmRule>, channel: 'EMAIL' | 'SMS'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of Object.keys(PARAM_LABEL)) {
    if (name === 'utm_medium') out[name] = channel === 'SMS' ? 'sms' : 'email'
    else if (name === 'utm_creative_format') out[name] = channel === 'SMS' ? 'text' : 'email'
    else {
      const rule = params[name]
      out[name] = !rule || rule.kind === 'none' ? '' : slug(rule.kind === 'text' ? rule.value : EXAMPLE[rule.value] ?? '')
    }
  }
  return out
}

/** Settings → UTM Tracking for anyone who writes campaigns or texts (the counter needs it); null while loading or when not allowed */
export function useUtmSettings(enabled = true) {
  return useQuery({ queryKey: UTM_KEY, queryFn: ({ signal }) => api.get<UtmSettings>('/workspace/utm/', undefined, signal), enabled, staleTime: 5 * 60_000, retry: false })
}

const URL_RE = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi

/** a text as it is counted when its links to your sites go out as short links: each such address stands for a short link's length */
export function withShortLinks(text: string, settings: Pick<UtmSettings, 'sms' | 'domains' | 'short_base' | 'ready'> | null | undefined): string {
  if (!settings?.sms || !settings.ready || settings.domains.length === 0) return text
  const short = `${settings.short_base}/xxxxxxx/`
  return text.replace(URL_RE, (url) => {
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { return url }
    const own = settings.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
    return own && !/unsubscribe|preference/i.test(url) ? short : url
  })
}
