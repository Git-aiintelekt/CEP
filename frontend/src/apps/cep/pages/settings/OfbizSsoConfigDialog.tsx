import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { buttonPrimary, buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { api, ApiError } from '@/lib/api'

/** GET /platform/sso-config/<code>/: tenant.sso_config with secret_enc opened (platform administrators only) */
interface OfbizSsoConfig {
  code: string
  name: string
  is_active: boolean
  site_key: string
  api_key: string
  time_zone: string
  roles: Record<string, string>
  /** false while the seed's plain text is still in the column; it is encrypted on the first launch or on save */
  encrypted: boolean
  problem: string | null
}

interface ConfigWorkspace { code: string; name: string; configured: boolean }

type RoleRow = { code: string; name: string }

const toRows = (roles: Record<string, string>): RoleRow[] => Object.entries(roles).map(([code, name]) => ({ code, name }))

function ConfigForm({ config }: { config: OfbizSsoConfig }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(config)
  const [roles, setRoles] = useState(() => toRows(config.roles))
  const [showKey, setShowKey] = useState(false)
  const set = <K extends keyof OfbizSsoConfig>(key: K, value: OfbizSsoConfig[K]) => setForm((current) => ({ ...current, [key]: value }))
  const setRole = (index: number, patch: Partial<RoleRow>) => setRoles((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const save = useMutation({
    mutationFn: () => api.put<OfbizSsoConfig>(`/platform/sso-config/${encodeURIComponent(config.code)}/`, {
      is_active: form.is_active, site_key: form.site_key, api_key: form.api_key, time_zone: form.time_zone,
      roles: Object.fromEntries(roles.filter((row) => row.code.trim() || row.name.trim()).map((row) => [row.code.trim(), row.name.trim()])) }),
    onSuccess: (data) => {
      queryClient.setQueryData(['platform', 'sso-config', config.code], data)
      void queryClient.invalidateQueries({ queryKey: ['platform', 'sso-config-workspaces'] })
      setForm(data); setRoles(toRows(data.roles))
    },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null

  return (
    <form id="ofbiz-sso-config" className="space-y-4" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      {config.problem && <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-text">{config.problem} Saving replaces the stored value.</p>}
      {!config.problem && config.site_key && !config.encrypted && (
        <p className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-ink-800">Still plain text from the seed. It is encrypted on the first Open CEP launch, or when you save.</p>)}
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={form.is_active} onChange={(event) => set('is_active', event.target.checked)} />
        <span><span className="block text-sm font-medium text-ink-900">Open CEP Is On</span><span className="block text-xs text-ink-800">When off, links from OFBiz are refused for this workspace.</span></span>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Site Key" required error={errors.site_key} hint="iCRM common.site.key">
          {(ids) => <TextInput {...ids} value={form.site_key} onChange={(event) => set('site_key', event.target.value)} autoComplete="off" />}
        </Field>
        <Field label="API Key" required error={errors.api_key} hint="iCRM common.api.key"
          labelEnd={<button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setShowKey((shown) => !shown)}>{showKey ? 'Hide' : 'Show'}</button>}>
          {(ids) => <TextInput {...ids} type={showKey ? 'text' : 'password'} value={form.api_key} onChange={(event) => set('api_key', event.target.value)} autoComplete="new-password" />}
        </Field>
        <Field label="Time Zone" required error={errors.time_zone} hint="The iCRM server's time zone, for example America/New_York.">
          {(ids) => <TextInput {...ids} value={form.time_zone} onChange={(event) => set('time_zone', event.target.value)} />}
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink-900">Roles</legend>
        <p className="text-xs text-ink-800">The iCRM role code OFBiz sends, and the CEP role it maps to.</p>
        {roles.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <TextInput aria-label="iCRM Role Code" className="flex-1" value={row.code} placeholder="MARKETING_ADMIN" onChange={(event) => setRole(index, { code: event.target.value })} />
            <TextInput aria-label="CEP Role Name" className="flex-1" value={row.name} placeholder="Marketing Admin" onChange={(event) => setRole(index, { name: event.target.value })} />
            <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setRoles((rows) => rows.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        {errors.roles && <p className="text-xs font-medium text-danger-text">{errors.roles}</p>}
        <button type="button" className={buttonSecondary} onClick={() => setRoles((rows) => [...rows, { code: '', name: '' }])}>Add Role</button>
      </fieldset>
      {other !== null && <ErrorState title="The keys were not saved" error={other} />}
      {save.isSuccess && <p role="status" className="text-sm text-success-text">Saved and encrypted.</p>}
      <div className="flex justify-end">
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save</button>
      </div>
    </form>
  )
}

export function OfbizSsoConfigDialog({ initialCode, onClose }: { initialCode: string; onClose: () => void }) {
  const [code, setCode] = useState(initialCode)
  const workspaces = useQuery({ queryKey: ['platform', 'sso-config-workspaces'],
    queryFn: ({ signal }) => api.get<{ workspaces: ConfigWorkspace[] }>('/platform/sso-config/', undefined, signal) })
  const config = useQuery({ queryKey: ['platform', 'sso-config', code],
    queryFn: ({ signal }) => api.get<OfbizSsoConfig>(`/platform/sso-config/${encodeURIComponent(code)}/`, undefined, signal), enabled: Boolean(code) })
  const list = workspaces.data?.workspaces ?? []

  return (
    <Modal size="lg" title="Open CEP Keys" subtitle="tenant.sso_config of each workspace, as OFBiz iCRM uses it. Platform administrators only." onClose={onClose}>
      <div className="space-y-4 p-4">
        <Field label="Workspace Code">
          {(ids) => <Select {...ids} value={code} onChange={(event) => setCode(event.target.value)}>
            {!list.some((workspace) => workspace.code === code) && <option value={code}>{code}</option>}
            {list.map((workspace) => <option key={workspace.code} value={workspace.code}>{workspace.code} · {workspace.name}{workspace.configured ? '' : ' (Not Set Up)'}</option>)}
          </Select>}
        </Field>
        {workspaces.isError && <ErrorState title="The workspaces could not be loaded" error={workspaces.error} />}
        {config.isError ? <ErrorState error={config.error} onRetry={() => void config.refetch()} />
          : config.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
          : <ConfigForm key={config.data.code} config={config.data} />}
      </div>
    </Modal>
  )
}
