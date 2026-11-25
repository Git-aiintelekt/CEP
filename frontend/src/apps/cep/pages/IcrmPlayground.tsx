/** /dev/icrm (dev builds only): Back to iCRM in the real top bar for each kind of session, and the iCRM URL field in
 * Settings → Integrations, on sample data with nothing from the API. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { OfbizSignOnSection } from '@/apps/cep/pages/settings/OfbizSignOnSection'
import type { Me } from '@/lib/types'
import { TopBar } from '@/shell/TopBar'

const ME: Me = {
  principal: { kind: 'user', id: 'u1', email: 'sharmila@example.com', display_name: 'Sharmila K', roles: ['Marketing Admin'], permissions: [] },
  tenant: { id: 't1', code: 'NWA', timezone: 'America/New_York', db_alias: 'default', db_status: 'READY' },
  workspace: { name: 'Northwind Apparel', plan: null, environment: 'PRODUCTION' },
  components: [],
}

const STATES: { title: string; icrm: Me['icrm'] }[] = [
  { title: 'Opened from iCRM, iCRM URL set: Back to iCRM works', icrm: { from_icrm: true, address_set: true } },
  { title: 'Opened from iCRM, no iCRM URL yet: disabled, the tooltip says why', icrm: { from_icrm: true, address_set: false } },
  { title: 'Signed in with a password: no Back to iCRM', icrm: { from_icrm: false, address_set: true } },
]

function Bar({ icrm }: { icrm: Me['icrm'] }) {
  const searchRef = useRef<HTMLInputElement>(null)
  return <TopBar me={{ ...ME, icrm }} components={[]} current={null} pages={[]} searchRef={searchRef} onHelp={() => undefined} onLogout={() => undefined} />
}

export default function IcrmPlayground() {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(['workspace', 'ofbiz-sso'], { workspace: 'NWA', site_key: 'site-key-123', api_key: 'api-key-456', icrm_url: 'https://icrmbasestaging.aiintelekt.com/customer-portal/control/findCustomer',
      has_api_key: true, configured: true, problem: null })
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen space-y-6 bg-canvas pb-10">
        {STATES.map((state) => (
          <section key={state.title} aria-label={state.title}>
            <p className="px-4 pt-4 pb-2 text-sm font-medium text-ink-800">{state.title}</p>
            <Bar icrm={state.icrm} />
          </section>
        ))}
        <div className="mx-auto max-w-4xl px-4 pt-4"><OfbizSignOnSection /></div>
      </div>
    </QueryClientProvider>
  )
}
