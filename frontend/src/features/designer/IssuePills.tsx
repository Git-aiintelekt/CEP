/** The Errors and Links pills that sit in the editor's tab bar, with their dropdown panels. */
import { CircleAlert, CircleCheck, Link2, TriangleAlert } from 'lucide-react'

import { MenuRow } from '@/components/MenuRow'
import { Pill } from '@/components/Pill'
import { Popover, PopoverHeading } from '@/components/Popover'
import { Tag } from '@/components/StatusBadge'
import type { PersonalizationTag } from '@/lib/types'
import type { SingleDropdown } from '@/lib/useSingleDropdown'

import { issueLines, type Issue } from './issues'
import { unknownTagsIn, type LinkEntry } from './links'

export type PillKey = 'history' | 'errors' | 'links' | 'receiptHistory'
export type PillController = SingleDropdown<PillKey>

export const ERRORS_HEADING = 'Errors — must be fixed to save or activate'
export const WARNINGS_HEADING = 'Warnings — advisory, never block'
const NO_ERRORS = 'Nothing to fix — all required content resolves.'
const NO_WARNINGS = 'No warnings.'

export function ErrorsPill({ issues, controller, onJump }: { issues: Issue[]; controller: PillController; onJump: (issue: Issue) => void }) {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const open = controller.isOpen('errors')

  const choose = (issue: Issue) => {
    onJump(issue)
    // focus belongs in the field being fixed, not back on the pill
    controller.close({ restoreFocus: false })
  }

  const { tone, icon, label } =
    errors.length > 0 ? { tone: 'danger' as const, icon: CircleAlert, label: `Review Errors · ${errors.length}` }
    : warnings.length > 0 ? { tone: 'warning' as const, icon: TriangleAlert, label: `${warnings.length} ${warnings.length === 1 ? 'Warning' : 'Warnings'}` }
    : { tone: 'neutral' as const, icon: CircleCheck, label: 'No Errors' }

  return (
    <div className="relative">
      <Pill {...controller.triggerProps('errors')} tone={tone} icon={icon} open={open}>
        {label}
      </Pill>

      {open && (
        <Popover label="Errors" width={420} placement="bottom-end" {...controller.panelProps('errors')} className="max-h-[460px] overflow-y-auto">
          <PopoverHeading sticky>{ERRORS_HEADING}</PopoverHeading>
          {errors.length === 0 ?
            <EmptySection icon={CircleCheck} text={NO_ERRORS} />
          : errors.map((issue) => <IssueRow key={issue.id} issue={issue} onChoose={choose} />)}
          <PopoverHeading sticky>{WARNINGS_HEADING}</PopoverHeading>
          {warnings.length === 0 ?
            <EmptySection icon={CircleCheck} text={NO_WARNINGS} last />
          : warnings.map((issue) => <IssueRow key={issue.id} issue={issue} onChoose={choose} />)}
        </Popover>
      )}
    </div>
  )
}

function EmptySection({ icon: Icon, text, last = false }: { icon: typeof CircleCheck; text: string; last?: boolean }) {
  return (
    <p className={`flex items-start gap-2.5 px-3 py-3 text-helper text-success-text ${last ? '' : 'border-b border-line-subtle'}`}>
      <Icon size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0 text-success" />
      {text}
    </p>
  )
}

function IssueRow({ issue, onChoose }: { issue: Issue; onChoose: (issue: Issue) => void }) {
  const error = issue.severity === 'error'
  const Icon = error ? CircleAlert : TriangleAlert
  const lines = issueLines(issue.message)
  return (
    <MenuRow
      onClick={() => onChoose(issue)}
      tone={error ? 'error' : 'warning'}
      title={lines.title}
      detail={
        lines.detail || issue.stale ?
          <>
            {lines.detail}
            {issue.stale ? <span className="block">As of last save</span> : null}
          </>
        : undefined
      }
      leading={<Icon size={16} strokeWidth={1.5} aria-hidden className={error ? 'text-danger' : 'text-warning'} />}
    />
  )
}

const FLAG_NOTE: Record<string, string> = {
  insecure: 'Uses http:// instead of https://',
}

const EMPTY_NOTE: Record<LinkEntry['element'], string> = {
  button: 'This button has no link',
  social: 'This icon has no link',
  link: 'This link has no destination',
}

function noteFor(link: LinkEntry, tags: PersonalizationTag[]): string | null {
  if (link.flags.includes('empty')) return EMPTY_NOTE[link.element]
  if (link.flags.includes('unknown-tag')) {
    const unknown = unknownTagsIn(link.url, tags)
    return `The tag {{${unknown[0] ?? ''}}} is not a known personalization tag`
  }
  if (link.flags.includes('insecure')) return FLAG_NOTE.insecure
  return null
}

export function LinksPill({ links, tags, controller, onJump }: { links: LinkEntry[]; tags: PersonalizationTag[]; controller: PillController; onJump: (link: LinkEntry) => void }) {
  const flagged = links.filter((link) => link.flags.length > 0)
  const open = controller.isOpen('links')

  const choose = (link: LinkEntry) => {
    onJump(link)
    controller.close({ restoreFocus: false })
  }

  return (
    <div className="relative">
      {/* links never block anything, so this pill is warning at worst — never danger, never blue */}
      <Pill
        {...controller.triggerProps('links')}
        tone={flagged.length > 0 ? 'warning' : 'neutral'}
        icon={flagged.length > 0 ? TriangleAlert : Link2}
        open={open}
      >
        {flagged.length > 0 ? `Review Links · ${flagged.length}` : `Links · ${links.length}`}
      </Pill>

      {open && (
        <Popover label="Links" width={440} placement="bottom-end" {...controller.panelProps('links')}>
          <PopoverHeading>
            {links.length === 0 ?
              'No links yet'
            : flagged.length > 0 ?
              `${flagged.length} of ${links.length} need a look`
            : `${links.length} ${links.length === 1 ? 'Link' : 'Links'}`}
          </PopoverHeading>
          {links.length === 0 ?
            <div className="px-3 py-3">
              <p className="text-helper text-ink-900">No links in this email yet.</p>
              <p className="mt-1 text-xs text-ink-800">Add a button or a link in a text block to give readers somewhere to go.</p>
            </div>
          : <div className="max-h-96 overflow-y-auto">
              {links.map((link) => {
                const note = noteFor(link, tags)
                const flaggedLink = link.flags.length > 0
                return (
                  <button
                    key={link.id}
                    type="button"
                    data-dropdown-item
                    onClick={() => choose(link)}
                    className="cep-focus-inset grid w-full grid-cols-[16px_minmax(0,1fr)_96px] items-center gap-2.5 border-b border-line-subtle p-3 text-left transition-colors duration-base ease-standard last:border-b-0 hover:bg-surface-subtle"
                  >
                    {flaggedLink ?
                      <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="text-warning" />
                    : <Link2 size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium text-ink-900">{link.url || '—'}</span>
                      <span className="truncate text-xs text-ink-800">
                        {link.label}
                        {note ? ' · ' : ''}
                        {note && <span className={flaggedLink ? 'text-warning-text' : ''}>{note}</span>}
                      </span>
                    </span>
                    <span className="justify-self-end">
                      <Tag tone={flaggedLink ? 'warning' : 'neutral'}>{link.kind === 'tracked' ? 'Tracked' : 'Advisory'}</Tag>
                    </span>
                  </button>
                )
              })}
            </div>
          }
        </Popover>
      )}
    </div>
  )
}
