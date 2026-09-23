import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { PasswordLink, Role, SettingsUser } from '@/lib/types'

type Editing = { mode: 'create' } | { mode: 'edit'; user: SettingsUser } | null

function UserForm({ editing, roles, onClose }: { editing: NonNullable<Editing>; roles: Role[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const user = editing.mode === 'edit' ? editing.user : null
  const [email, setEmail] = useState(user?.email ?? '')
  const [name, setName] = useState(user?.display_name ?? '')
  const [chosen, setChosen] = useState<string[]>(user?.roles ?? [])
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const save = useMutation({
    mutationFn: () => (user ? api.patch<SettingsUser>(`/users/${user.id}/`, { display_name: name.trim(), roles: chosen })
                            : api.post<SettingsUser>('/users/', { email: email.trim(), display_name: name.trim(), roles: chosen })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['workspace'] })
      onClose()
    },
    onError: (error) => error instanceof ApiError && error.status === 400 && setErrors(error.fieldErrors),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!user && !/^\S+@\S+\.\S+$/.test(email.trim())) found.email = 'Enter an email address.'
    if (name.trim().length < 2) found.display_name = "Enter the person's name."
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate()
  }

  const other = save.isError && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null
  return (
    <Modal title={user ? `Edit ${user.display_name}` : 'Add a user'} onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="user-form" className={buttonPrimary} disabled={save.isPending}>
          {save.isPending && <Spinner size="sm" tone="onBrand" />}{user ? 'Save changes' : 'Add user'}
        </button>
      </>}>
      <form id="user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {other !== null && <ErrorState title="Could not save the user" error={other} />}
        <Field label="Email" required error={errors.email} hint={user ? 'The email address is the sign-in name and cannot be changed.' : 'They sign in with this address.'}>
          {(ids) => <TextInput {...ids} type="email" value={email} disabled={Boolean(user)} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Name" required error={errors.display_name}>
          {(ids) => <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink-700">Roles</legend>
          {errors.roles && <p className="mt-1 text-xs font-medium text-danger-text">{errors.roles}</p>}
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {roles.map((role) => (
              <li key={role.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-subtle">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={chosen.includes(role.id)}
                    onChange={() => setChosen(chosen.includes(role.id) ? chosen.filter((id) => id !== role.id) : [...chosen, role.id])} />
                  <span><span className="block text-sm font-medium text-ink-900">{role.name}</span>
                    <span className="block text-xs text-ink-500">{role.description || `${role.permissions.length} permissions`}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {chosen.length === 0 && <p className="mt-1.5 text-xs text-ink-500">Without a role the user can sign in but sees nothing.</p>}
        </fieldset>
        {!user && <p className="rounded-lg bg-surface-subtle px-3 py-2 text-xs text-ink-500">No password is set here. After adding the user, create a password link and send it to them: they choose their own password.</p>}
      </form>
    </Modal>
  )
}

function PasswordLinkDialog({ user, onClose }: { user: SettingsUser; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = useQuery({ queryKey: ['settings', 'password-link', user.id], queryFn: () => api.post<PasswordLink>(`/users/${user.id}/password-link/`), gcTime: 0, staleTime: Infinity, retry: false })
  // a new link each time: emailing makes the one on screen the same one that lands in the inbox
  const email = useMutation({ mutationFn: () => api.post<PasswordLink>(`/users/${user.id}/password-link/`, { send: true }) })
  const current = email.data ?? link.data
  const url = current ? `${window.location.origin}${current.path}` : ''

  return (
    <Modal title={`Password link for ${user.display_name}`} onClose={onClose} footer={<button type="button" className={buttonPrimary} onClick={onClose}>Done</button>}>
      {link.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Creating the link</p>
        : link.isError ? <ErrorState title="Could not create a link" error={link.error} />
        : (
          <div className="space-y-3 text-sm text-ink-700">
            {link.data.email_configured !== false && (
              <div className="rounded-lg border border-line px-3 py-3">
                {email.data?.emailed ? <p role="status" className="font-medium text-success-text">Sent to {user.email}. They choose their own password from the message.</p>
                  : (<div className="flex flex-wrap items-center justify-between gap-3">
                      <p>Email the link to <strong>{user.email}</strong>: you never have to handle it.</p>
                      <button type="button" className={buttonPrimary} disabled={email.isPending} onClick={() => email.mutate()}>
                        {email.isPending && <Spinner size="sm" tone="onBrand" />}Email the link
                      </button>
                    </div>)}
                {(email.isError || email.data?.emailed === false) && <p role="alert" className="mt-2 text-xs font-medium text-danger-text">The email could not be sent. Copy the link below instead.</p>}
              </div>
            )}
            <p>{link.data.email_configured !== false ? 'Or send' : 'Send'} this link to <strong>{user.email}</strong> yourself, by a channel you trust. On it they choose their own password: you never see it.</p>
            <label className="block text-xs font-semibold tracking-wide text-ink-500 uppercase" htmlFor="password-link">One-time link</label>
            <div className="flex gap-2">
              <input id="password-link" readOnly value={url} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 h-10 rounded-control-lg border border-line bg-surface-subtle px-3 cep-num text-xs" />
              <button type="button" className={buttonSecondary} onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <p className="text-xs text-ink-500">It works once, for {link.data.expires_in_hours} hours, and stops working as soon as they sign in. Anyone holding it can set the password, so do not post it in a shared channel.</p>
          </div>
        )}
    </Modal>
  )
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing>(null)
  const [linkFor, setLinkFor] = useState<SettingsUser | null>(null)
  const users = useQuery({ queryKey: ['settings', 'users'], queryFn: ({ signal }) => api.get<SettingsUser[]>('/users/', undefined, signal) })
  const roles = useQuery({ queryKey: ['settings', 'roles'], queryFn: ({ signal }) => api.get<Role[]>('/roles/', undefined, signal) })

  const toggle = useMutation({
    mutationFn: (user: SettingsUser) => api.patch<SettingsUser>(`/users/${user.id}/`, { is_active: !user.is_active }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['settings'] }); void queryClient.invalidateQueries({ queryKey: ['workspace'] }) },
  })

  const columns: Column<SettingsUser>[] = [
    { key: 'name', header: 'User', render: (user) => (
      <div><p className="font-medium text-ink-900">{user.display_name}{user.is_self && <span className="ml-2 text-xs font-normal text-ink-500">you</span>}</p>
        <p className="text-xs text-ink-500">{user.email}</p></div>) },
    { key: 'roles', header: 'Roles', render: (user) => user.role_names.length ? <span className="flex flex-wrap gap-1">{user.role_names.map((role) => <Tag key={role}>{role}</Tag>)}</span> : <span className="text-ink-500">No role</span> },
    { key: 'status', header: 'Status', render: (user) => <StatusBadge status={user.is_active ? 'ACTIVE' : 'ARCHIVED'} label={user.is_active ? 'Active' : 'Deactivated'} /> },
    { key: 'signin', header: 'Sign-in', render: (user) => user.auth_provider !== 'LOCAL' ? <Tag>{user.auth_provider}</Tag> : user.has_password ? formatDateTime(user.last_login).replace('—', 'Never signed in') : <span className="text-warning-text">No password yet</span> },
    { key: 'actions', header: '', align: 'right', render: (user) => (
      <span className="flex justify-end gap-3 text-sm font-medium">
        <button type="button" className="text-brand-800 hover:underline" onClick={() => setEditing({ mode: 'edit', user })}>Edit</button>
        {user.is_active && user.auth_provider === 'LOCAL' && <button type="button" className="text-brand-800 hover:underline" onClick={() => setLinkFor(user)}>Password link</button>}
        {!user.is_self && <button type="button" className={user.is_active ? 'text-danger-text hover:underline' : 'text-brand-800 hover:underline'} disabled={toggle.isPending}
          onClick={() => (user.is_active ? window.confirm(`Deactivate ${user.display_name}? They will not be able to sign in.`) : true) && toggle.mutate(user)}>{user.is_active ? 'Deactivate' : 'Activate'}</button>}
      </span>) },
  ]

  if (users.isError) return <ErrorState error={users.error} onRetry={() => void users.refetch()} />
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Users are deactivated, never deleted, so everything they created keeps its author.</p>
        <button type="button" className={buttonPrimary} onClick={() => setEditing({ mode: 'create' })}>Add user</button>
      </div>
      {toggle.isError && <div className="mb-4"><ErrorState title="Could not change the user" error={toggle.error} /></div>}
      {users.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading users</p>
        : users.data.length === 0 ? <EmptyState title="No users yet" />
        : <DataTable columns={columns} rows={users.data} rowKey={(user) => user.id} caption="Users" />}
      {editing && <UserForm editing={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
      {linkFor && <PasswordLinkDialog user={linkFor} onClose={() => setLinkFor(null)} />}
    </div>
  )
}
