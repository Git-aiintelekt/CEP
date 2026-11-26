import { useMutation } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'

import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { navigation } from '@/lib/visit'
import type { Me } from '@/lib/types'

const NO_ADDRESS = 'Ask your administrator to add the iCRM URL in Settings, Integrations.'

/**
 * Back to iCRM, beside the workspace: the iCRM page set in Settings → Integrations, with a token the API makes for the
 * person (as iCRM's Open CEP does), so iCRM can sign them in. It opens in a new tab and CEP stays open. Shown only to a
 * session opened from iCRM; disabled until the iCRM URL is set.
 */
export function BackToIcrm({ icrm }: { icrm: Me['icrm'] }) {
  const toast = useToast()
  // the tab opens on the click itself, before the API answers, so a popup blocker lets it through
  const go = useMutation({
    mutationFn: (_tab: Window | null) => api.post<{ url: string }>('/auth/sso/ofbiz/back/'),
    onSuccess: ({ url }, tab) => (tab ? tab.location.replace(url) : navigation.go(url)),
    onError: (error, tab) => { tab?.close(); toast.failure(error, 'iCRM was not opened') },
  })
  if (!icrm?.from_icrm) return null
  const reason = icrm.address_set ? null : NO_ADDRESS
  const busy = go.isPending
  const open = () => {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    go.mutate(tab)
  }
  return (
    <button
      type="button"
      data-back-to-icrm
      disabled={reason !== null || busy}
      title={reason ?? 'Back to C360'}
      aria-label="Back to C360"
      onClick={open}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-control-md border border-sidebar-divider px-2 text-sm font-medium whitespace-nowrap text-on-brand transition-colors duration-fast ease-standard outline-none hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent active:bg-sidebar-pressed disabled:cursor-not-allowed disabled:text-sidebar-icon disabled:hover:bg-transparent lg:px-2.5"
    >
      {busy ? <Spinner size="sm" tone="onBrand" /> : <ExternalLink size={16} strokeWidth={1.5} aria-hidden />}
      <span className="hidden lg:inline">Back to C360</span>
    </button>
  )
}
