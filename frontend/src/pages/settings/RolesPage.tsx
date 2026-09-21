import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary, buttonSecondary, Field, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { PermissionDef, Role } from '@/lib/types'

const AREA_LABEL: Record<string, string> = {
  campaign: 'Campaigns', list: 'Contact lists', template: 'Templates', journey: 'Journeys', consent: 'Consent', governance: 'Sending rules',
  provider: 'Delivery providers', report: 'Reports', user: 'Administration',
}
const ACTION_LABEL: Record<string, string> = { view: 'View', edit: 'Create and edit', publish: 'Publish', activate: 'Activate', import: 'Import', admin: 'Manage users, roles and API keys' }

type Editing = { role: Role | null } | null

function RoleForm({ role, catalogue, onClose }: { role: Role | null; catalogue: PermissionDef[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [chosen, setChosen] = useState<string[]>(role?.permissions ?? [])
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const areas = useMemo(() => {
    const grouped = new Map<string, PermissionDef[]>()
    for (const permission of catalogue) {
      const area = permission.code.split('.')[0]
      grouped.set(area, [...(grouped.get(area) ?? []), permission])
    }
    return [...grouped.entries()]
  }, [catalogue])

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, permissions: chosen }
      return role ? api.patch<Role>(`/roles/${role.id}/`, body) : api.post<Role>('/roles/', body)
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['settings'] }); onClose() },
    onError: (error) => error instanceof ApiError && error.status === 400 && setErrors(error.fieldErrors),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) return setErrors({ name: 'Enter a role name.' })
    setErrors({})
    save.mutate()
  }
  const toggle = (code: string) => setChosen(chosen.includes(code) ? chosen.filter((item) => item !== code) : [...chosen, code])
  const other = save.isError && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null

  return (
    <Modal size="lg" title={role ? `Edit ${role.name}` : 'New role'} onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="role-form" className={buttonPrimary} disabled={save.isPending}>
          {save.isPending && <Spinner size="sm" tone="onBrand" />}{role ? 'Save changes' : 'Create role'}
        </button>
      </>}>
      <form id="role-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {other !== null && <ErrorState title="Could not save the role" error={other} />}
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Name" required error={errors.name}>{(ids) => <TextInput {...ids} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />}</Field>
          <Field label="Description" error={errors.description}>{(ids) => <TextArea {...ids} rows={1} value={description} onChange={(event) => setDescription(event.target.value)} />}</Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink-700">Permissions <span className="font-normal text-ink-500">({chosen.length} selected)</span></legend>
          {errors.permissions && <p role="alert" className="mt-1 text-xs font-medium text-danger-text">{errors.permissions}</p>}
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {areas.map(([area, permissions]) => (
              <div key={area} className="rounded-lg border border-line p-3">
                <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{AREA_LABEL[area] ?? area}</p>
                <ul className="mt-1.5 space-y-1">
                  {permissions.map((permission) => (
                    <li key={permission.code}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-900">
                        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={chosen.includes(permission.code)} onChange={() => toggle(permission.code)} />
                        {ACTION_LABEL[permission.code.split('.')[1]] ?? permission.description ?? permission.code}
                        <span className="cep-num text-xs text-ink-500">{permission.code}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}

export function RolesPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing>(null)
  const roles = useQuery({ queryKey: ['settings', 'roles'], queryFn: ({ signal }) => api.get<Role[]>('/roles/', undefined, signal) })
  const catalogue = useQuery({ queryKey: ['settings', 'permissions'], queryFn: ({ signal }) => api.get<PermissionDef[]>('/roles/permissions/', undefined, signal), staleTime: 10 * 60_000 })
  const remove = useMutation({ mutationFn: (role: Role) => api.delete(`/roles/${role.id}/`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }) })

  const columns: Column<Role>[] = [
    { key: 'name', header: 'Role', render: (role) => <div><p className="font-medium text-ink-900">{role.name}</p>{role.description && <p className="text-xs text-ink-500">{role.description}</p>}</div> },
    { key: 'permissions', header: 'Permissions', align: 'right', render: (role) => `${role.permissions.length} of ${catalogue.data?.length ?? '…'}` },
    { key: 'users', header: 'Users', align: 'right', render: (role) => formatNumber(role.user_count) },
    { key: 'actions', header: '', align: 'right', render: (role) => (
      <span className="flex justify-end gap-1">
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setEditing({ role })}>Edit</button>
        <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} disabled={role.user_count > 0 || remove.isPending}
          title={role.user_count > 0 ? 'People still have this role' : undefined}
          onClick={() => window.confirm(`Delete the role "${role.name}"?`) && remove.mutate(role)}>Delete</button>
      </span>) },
  ]

  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">A role is a named set of permissions. People can hold several roles: they get the sum.</p>
        <button type="button" className={buttonPrimary} onClick={() => setEditing({ role: null })}>New role</button>
      </div>
      {remove.isError && <div className="mb-4"><ErrorState title="Could not delete the role" error={remove.error} /></div>}
      {roles.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading roles</p>
        : <DataTable columns={columns} rows={roles.data} rowKey={(role) => role.id} caption="Roles" />}
      {editing && <RoleForm role={editing.role} catalogue={catalogue.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  )
}
