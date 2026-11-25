import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { buttonPrimary, Field, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'

/** GET/PUT /workspace/ofbiz-sso/: this workspace's tenant.sso_config, as iCRM's CEP Configuration screen names it */
interface OfbizLink {
  workspace: string
  site_key: string
  api_key: string
  /** the iCRM page Back to iCRM opens, e.g. https://icrm.example.com/customer-portal/control/findCustomer; "" when not set */
  icrm_url: string
  has_api_key: boolean
  configured: boolean
  problem: string | null
}

const KEY = ['workspace', 'ofbiz-sso']

function SignOnForm({ link }: { link: OfbizLink }) {
  const queryClient = useQueryClient()
  const [siteKey, setSiteKey] = useState(link.site_key)
  const [apiKey, setApiKey] = useState(link.api_key)
  const [icrmUrl, setIcrmUrl] = useState(link.icrm_url ?? '')
  const [showKey, setShowKey] = useState(false)

  const save = useMutation({
    mutationFn: () => api.put<OfbizLink>('/workspace/ofbiz-sso/', { site_key: siteKey.trim(), api_key: apiKey.trim(), icrm_url: icrmUrl.trim() }),
    onSuccess: (data) => { queryClient.setQueryData(KEY, data); setSiteKey(data.site_key); setApiKey(data.api_key); setIcrmUrl(data.icrm_url ?? '') },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && !errors.site_key && !errors.api_key && !errors.icrm_url ? save.error : null

  return (
    <form className="space-y-4" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-800">CEP Tenant Code <span className="cep-num ml-1 font-medium text-ink-900">{link.workspace}</span></p>
        <StatusBadge status={link.configured ? 'ACTIVE' : 'DRAFT'} label={link.configured ? 'Set Up' : 'Not Set Up'} />
      </div>
      {link.problem && <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-text">{link.problem} Saving replaces the stored keys.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Site Key" required error={errors.site_key} hint="iCRM security / common.site.key, character for character.">
          {(ids) => <TextInput {...ids} value={siteKey} onChange={(event) => setSiteKey(event.target.value)} autoComplete="off" />}
        </Field>
        <Field label="API Key" required error={errors.api_key} hint="iCRM cep / cep.api.key, character for character. Stored encrypted."
          labelEnd={<button type="button" className="text-label font-medium text-brand-800 hover:underline" aria-pressed={showKey} onClick={() => setShowKey((shown) => !shown)}>{showKey ? 'Hide' : 'Show'}</button>}>
          {(ids) => <TextInput {...ids} type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" />}
        </Field>
        <div className="lg:col-span-2">
          <Field label="iCRM URL" error={errors.icrm_url}
            hint="The iCRM page Back to iCRM opens, for example https://icrm.example.com/customer-portal/control/findCustomer. CEP adds a sign-in token for each person, so leave out ?token= and externalLoginKey.">
            {(ids) => <TextInput {...ids} type="url" value={icrmUrl} onChange={(event) => setIcrmUrl(event.target.value)} placeholder="https://" autoComplete="off" />}
          </Field>
        </div>
      </div>
      {other !== null && <ErrorState title="The sign-on settings were not saved" error={other} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save Sign-On</button>
        {save.isSuccess && <span role="status" className="self-center text-sm text-success-text">Saved</span>}
      </div>
    </form>
  )
}

export function OfbizSignOnSection() {
  const link = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<OfbizLink>('/workspace/ofbiz-sso/', undefined, signal) })

  return (
    <section aria-labelledby="ofbiz-heading">
      <div className="mb-3">
        <h2 id="ofbiz-heading" className="font-display text-section-title font-semibold text-ink-900">Sign-On from OFBiz iCRM</h2>
        <p className="text-sm text-ink-800">"Open CEP" in iCRM signs people in to this workspace. Enter the same keys as iCRM's CEP Configuration screen.</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-5">
        {link.isError ? <ErrorState error={link.error} onRetry={() => void link.refetch()} />
          : link.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading sign-on settings</p>
          : <SignOnForm link={link.data} />}
      </div>
    </section>
  )
}
