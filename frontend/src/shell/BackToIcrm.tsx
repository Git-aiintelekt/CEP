import { useMutation } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { navigation } from '@/lib/visit'
import type { Me } from '@/lib/types'

const NO_ADDRESS = 'Ask your administrator to add the iCRM URL in Settings, Integrations.'

/**
 * Back to iCRM, beside the workspace: the iCRM page set in Settings → Integrations, with the externalLoginKey iCRM passed on
 * "Open CEP", so the person is back in their own iCRM session. Shown only to a session opened from iCRM; disabled until the
 * iCRM URL is set.
 */
export function BackToIcrm({ icrm }: { icrm: Me['icrm'] }) {
  const toast = useToast()
  const go = useMutation({
    mutationFn: () => api.post<{ url: string }>('/auth/sso/ofbiz/back/'),
    onSuccess: ({ url }) => navigation.go(url),
    onError: (error) => toast.failure(error, 'iCRM was not opened'),
  })
  if (!icrm?.from_icrm) return null
  const reason = icrm.address_set ? null : NO_ADDRESS
  const busy = go.isPending || go.isSuccess
  return (
    <button
      type="button"
      data-back-to-icrm
      disabled={reason !== null || busy}
      title={reason ?? 'Back to iCRM'}
      aria-label="Back to iCRM"
      onClick={() => go.mutate()}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-control-md border border-sidebar-divider px-2 text-sm font-medium whitespace-nowrap text-on-brand transition-colors duration-fast ease-standard outline-none hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent active:bg-sidebar-pressed disabled:cursor-not-allowed disabled:text-sidebar-icon disabled:hover:bg-transparent lg:px-2.5"
    >
      {busy ? <Spinner size="sm" tone="onBrand" /> : <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />}
      <span className="hidden lg:inline">Back to iCRM</span>
    </button>
  )
}
