/**
 * "Start from" picker on the New template page: Blank plus the server's starter templates for the chosen channel,
 * grouped by category down the side, each with a full-size preview behind its eye button.
 */
import { useQuery } from '@tanstack/react-query'
import { Eye, Plus, Search } from 'lucide-react'
import { useState } from 'react'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { DEFAULT_PROFILE, fillForPreview } from '@/features/designer/preview/previewProfiles'
import { renderWithSamples } from '@/features/messaging/sms'
import { api } from '@/lib/api'
import type { Page, PersonalizationTag, TemplateStarter } from '@/lib/types'

import { ALL_CATEGORIES, categoriesOf, starterCount } from './starterCategories'

interface StarterGalleryProps {
  channel: string
  value: string
  onChange: (key: string, starter: TemplateStarter | null) => void
  /** inside the set-up pop-up: no box or "Start From" legend, the pop-up's step line names it */
  bare?: boolean
}

export const CATEGORIES_LABEL = 'Starter Categories'
export const USE_STARTER_LABEL = 'Use This Starter'

const CARD = 'group flex h-full w-full flex-col overflow-hidden rounded-lg border text-left transition-colors duration-fast ease-standard'
const state = (selected: boolean) => (selected ? 'border-link bg-brand-100' : 'border-line bg-surface hover:border-link')

/** A 600 px email shown at 40 %: the iframe keeps its real width so the layout is the desktop one, then is scaled down. */
function EmailThumbnail({ html, title }: { html: string; title: string }) {
  return (
    <div aria-hidden className="pointer-events-none h-40 overflow-hidden border-b border-line-subtle bg-surface-subtle">
      <iframe title={title} sandbox="" tabIndex={-1} srcDoc={html} loading="lazy" className="h-[520px] w-[640px] origin-top-left scale-[0.4] border-0 bg-surface" />
    </div>
  )
}

function MessageThumbnail({ text, picture }: { text: string; picture: boolean }) {
  return (
    <div aria-hidden className="flex h-40 flex-col justify-end gap-1.5 overflow-hidden border-b border-line-subtle bg-surface-subtle p-3">
      {picture && <div className="h-16 w-24 rounded-lg rounded-bl-md bg-brand-100" />}
      <p className="line-clamp-6 max-w-[92%] rounded-lg rounded-bl-md bg-surface px-3 py-2 text-xs leading-4 text-ink-900">{text}</p>
    </div>
  )
}

/** The whole starter at full size: the email scrolls inside its own frame, a message sits in its bubble. */
function StarterPreview({ starter, catalogue, onClose, onUse }: { starter: TemplateStarter; catalogue: PersonalizationTag[]; onClose: () => void; onUse: () => void }) {
  return (
    <Modal
      title={starter.name}
      subtitle={`${starter.category} · ${starter.description}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
          <button type="button" className={buttonPrimary} onClick={onUse}>{USE_STARTER_LABEL}</button>
        </>
      }
    >
      {starter.html_content ?
        <iframe
          title={`${starter.name} full preview`}
          sandbox=""
          srcDoc={fillForPreview(starter.html_content, catalogue, DEFAULT_PROFILE)}
          className="h-[70vh] w-full rounded-lg border border-line bg-surface"
        />
      : <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-subtle p-4">
          {starter.channel === 'MMS' && <div className="h-24 w-36 rounded-lg rounded-bl-md bg-brand-100" />}
          <p className="max-w-[80%] rounded-lg rounded-bl-md bg-surface px-3 py-2 text-sm leading-5 whitespace-pre-wrap text-ink-900">
            {renderWithSamples(starter.sms_body ?? '', catalogue)}
          </p>
        </div>
      }
    </Modal>
  )
}

export function StarterGallery({ channel, value, onChange, bare = false }: StarterGalleryProps) {
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
  // each is kept with the channel it was chosen for, so a channel change starts it over without an effect
  const [chosen, setChosen] = useState<{ channel: string; category: string } | null>(null)
  const category = chosen?.channel === channel ? chosen.category : ALL_CATEGORIES
  const [preview, setPreview] = useState<{ channel: string; starter: TemplateStarter } | null>(null)
  const previewing = preview?.channel === channel ? preview.starter : null

  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const all = starters.data ?? []
  const categories = categoriesOf(all)
  const shown = (category === ALL_CATEGORIES ? all : all.filter((starter) => starter.category === category))
    .filter((starter) => needle === '' || `${starter.name} ${starter.description} ${starter.category}`.toLowerCase().includes(needle))

  const Frame = bare ? 'div' : 'fieldset'
  return (
    <Frame className={bare ? '' : 'rounded-lg border border-line bg-surface p-5'}>
      {!bare && <legend className="px-1 text-sm font-semibold text-ink-900">Start From</legend>}
      <p className="mb-4 text-sm text-ink-800">A starter is only a beginning: it becomes version 1 of your template and you can change everything in it.</p>

      {starters.isPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading starters</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label={CATEGORIES_LABEL}>
            <p className="px-2.5 pb-1.5 text-xs font-semibold text-ink-800">Categories</p>
            <ul className="flex flex-wrap gap-0.5 lg:flex-col">
              {categories.map((row) => {
                const selected = row.name === category
                return (
                  <li key={row.name}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${row.name}, ${starterCount(row.count)}`}
                      onClick={() => setChosen({ channel, category: row.name })}
                      className={`flex h-9 w-full items-center justify-between gap-3 rounded-control-md px-2.5 text-sm transition-colors duration-fast ease-standard ${
                        selected ? 'bg-brand-100 font-semibold text-brand-800' : 'font-medium text-ink-900 hover:bg-surface-hover'
                      }`}
                    >
                      <span className="truncate">{row.name}</span>
                      <span className="cep-num text-helper">{row.count}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="flex min-w-0 flex-col gap-4">
          <label className="relative block">
            <span className="sr-only">Search Starter Templates</span>
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. welcome, receipt, sale"
              className="h-10 w-full rounded-control-lg border border-transparent bg-surface-sunken pr-3 pl-9 text-sm text-ink-900 transition-colors duration-base ease-standard placeholder:text-ink-300 focus:bg-surface focus-visible:border-focus" />
          </label>
          <div role="radiogroup" aria-label="Starting Point" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <button type="button" role="radio" aria-checked={value === ''} onClick={() => onChange('', null)} className={`${CARD} ${state(value === '')}`}>
              <div aria-hidden className="flex h-40 items-center justify-center border-b border-line-subtle bg-surface-subtle text-ink-800"><Plus size={24} strokeWidth={1.5} /></div>
              <div className="p-3">
                <p className="text-sm font-semibold text-ink-900">Blank</p>
                <p className="mt-0.5 text-xs text-ink-800">{isMessage ? 'Write the message from scratch.' : 'A simple skeleton with a heading, a button and the unsubscribe footer.'}</p>
              </div>
            </button>

            {shown.map((starter) => (
              <div key={starter.key} className="relative">
                <button type="button" role="radio" aria-checked={value === starter.key} onClick={() => onChange(starter.key, starter)} className={`${CARD} ${state(value === starter.key)}`}>
                  {starter.html_content ? (
                    // the preview's own rule, without its marks: a thumbnail reads like the email itself
                    <EmailThumbnail html={fillForPreview(starter.html_content, catalogue, DEFAULT_PROFILE)} title={`${starter.name} preview`} />
                  ) : (
                    <MessageThumbnail text={renderWithSamples(starter.sms_body ?? '', catalogue)} picture={starter.channel === 'MMS'} />
                  )}
                  <div className="p-3">
                    <p className="truncate text-sm font-semibold text-ink-900">{starter.name}</p>
                    <span className="mt-1.5 inline-flex h-5 items-center rounded-sm bg-fill-subtle px-1.5 text-xs font-medium text-ink-800">{starter.category}</span>
                    <p className="mt-1.5 text-xs text-ink-800">{starter.description}</p>
                  </div>
                </button>
                {/* beside the card, not inside it: a button cannot hold a button */}
                <button
                  type="button"
                  aria-label={`Preview ${starter.name}`}
                  title="Preview"
                  onClick={() => setPreview({ channel, starter })}
                  className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-control-md border border-line bg-surface text-ink-800 transition-colors hover:bg-surface-hover"
                >
                  <Eye size={16} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          {shown.length === 0 && needle !== '' && <p className="text-sm text-ink-800">No starters match "{search.trim()}". Try another word or clear the search.</p>}
          </div>
        </div>
      )}
      {starters.isError && <p className="mt-3 text-sm text-ink-800">Starters could not be loaded. You can still create a blank template.</p>}

      {previewing && (
        <StarterPreview
          starter={previewing}
          catalogue={catalogue}
          onClose={() => setPreview(null)}
          onUse={() => {
            onChange(previewing.key, previewing)
            setPreview(null)
          }}
        />
      )}
    </Frame>
  )
}
