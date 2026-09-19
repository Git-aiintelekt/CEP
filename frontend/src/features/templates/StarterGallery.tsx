/** "Start from" picker on the New template page: Blank plus the server's starter templates for the chosen channel. */
import { useQuery } from '@tanstack/react-query'

import { Spinner } from '@/components/States'
import { applySampleValues } from '@/features/designer/tags'
import { renderWithSamples } from '@/features/messaging/sms'
import { api } from '@/lib/api'
import type { Page, PersonalizationTag, TemplateStarter } from '@/lib/types'

interface StarterGalleryProps {
  channel: string
  value: string
  onChange: (key: string, starter: TemplateStarter | null) => void
}

const CARD = 'group flex h-full w-full flex-col overflow-hidden rounded-lg border-2 bg-surface text-left transition-colors'
const state = (selected: boolean) => (selected ? 'border-brand-600 ring-2 ring-brand-100' : 'border-line hover:border-brand-600')

/** A 600 px email shown at 40 %: the iframe keeps its real width so the layout is the desktop one, then is scaled down. */
function EmailThumbnail({ html, title }: { html: string; title: string }) {
  return (
    <div aria-hidden className="pointer-events-none h-52 overflow-hidden border-b border-line bg-surface-subtle">
      <iframe title={title} sandbox="" tabIndex={-1} srcDoc={html} loading="lazy" className="h-[520px] w-[640px] origin-top-left scale-[0.4] border-0 bg-surface" />
    </div>
  )
}

function MessageThumbnail({ text, picture }: { text: string; picture: boolean }) {
  return (
    <div aria-hidden className="flex h-52 flex-col justify-end gap-1.5 overflow-hidden border-b border-line bg-surface-subtle p-3">
      {picture && <div className="h-16 w-24 rounded-lg rounded-bl-md bg-brand-100" />}
      <p className="line-clamp-6 max-w-[92%] rounded-lg rounded-bl-md bg-surface px-3 py-2 text-xs leading-4 text-ink-900">{text}</p>
    </div>
  )
}

export function StarterGallery({ channel, value, onChange }: StarterGalleryProps) {
  const starters = useQuery({
    queryKey: ['template-starters', channel],
    queryFn: ({ signal }) => api.get<TemplateStarter[]>('/template-starters/', { channel }, signal),
    staleTime: 10 * 60_000,
  })
  const tags = useQuery({
    queryKey: ['personalization-tags', 'all'],
    queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal),
  })
  const catalogue = tags.data?.results ?? []
  const isMessage = channel === 'SMS' || channel === 'MMS'

  return (
    <fieldset className="rounded-lg border border-line bg-surface p-5">
      <legend className="px-1 text-sm font-semibold text-ink-900">Start from</legend>
      <p className="mb-4 text-sm text-ink-500">A starter is only a beginning: it becomes version 1 of your template and you can change everything in it.</p>

      {starters.isPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading starters</p>
      ) : (
        <div role="radiogroup" aria-label="Starting point" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button type="button" role="radio" aria-checked={value === ''} onClick={() => onChange('', null)} className={`${CARD} ${state(value === '')}`}>
            <div aria-hidden className="flex h-52 items-center justify-center border-b border-line bg-surface-subtle text-4xl font-light text-ink-300">+</div>
            <div className="p-3">
              <p className="text-sm font-semibold text-ink-900">Blank</p>
              <p className="mt-0.5 text-xs text-ink-500">{isMessage ? 'Write the message from scratch.' : 'A simple skeleton with a heading, a button and the unsubscribe footer.'}</p>
            </div>
          </button>

          {(starters.data ?? []).map((starter) => (
            <button key={starter.key} type="button" role="radio" aria-checked={value === starter.key} onClick={() => onChange(starter.key, starter)} className={`${CARD} ${state(value === starter.key)}`}>
              {starter.html_content ? (
                <EmailThumbnail html={applySampleValues(starter.html_content, catalogue)} title={`${starter.name} preview`} />
              ) : (
                <MessageThumbnail text={renderWithSamples(starter.sms_body ?? '', catalogue)} picture={starter.channel === 'MMS'} />
              )}
              <div className="p-3">
                <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-900">
                  {starter.name}
                  <span className="rounded-md bg-line-subtle px-1.5 py-0.5 text-xs font-medium text-ink-700">{starter.category}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-500">{starter.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {starters.isError && <p className="mt-3 text-sm text-ink-500">Starters could not be loaded. You can still create a blank template.</p>}
    </fieldset>
  )
}
