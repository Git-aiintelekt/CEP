/**
 * "Ask About" at the top of the Ask for a Report box (docs/mockups/ask-for-report-data-and-specs.html, option A): the data the
 * prompt is about, so the model reads only those fields. All My Data, the platform's datasets, each Report Database (its mapped
 * datasets, and under the chosen one a switch for its tables not mapped yet) and the uploaded files. The choice and the switch are
 * remembered per browser; a remembered database that is gone falls back to All My Data.
 */
import { ChevronDown } from 'lucide-react'

import { Checkbox } from '@/components/Checkbox'
import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import type { SingleDropdown } from '@/lib/useSingleDropdown'
import { engineMark, listed, plural, remember, scopeWords, SCOPE_KEY, UNMAPPED_KEY, type AskData } from '../askScope'
import type { AskScope } from '../types'

function Mark({ text, quiet = false }: { text: string; quiet?: boolean }) {
  return <span aria-hidden className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[9.5px] font-bold ${quiet ? 'bg-fill-subtle text-ink-800' : 'bg-brand-100 text-brand-800'}`}>{text}</span>
}

function SmallMark({ text }: { text: string }) {
  return <span aria-hidden className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-xs bg-brand-100 px-0.5 text-[9px] font-bold text-brand-800">{text}</span>
}

export function AskAbout({ scope, unmapped, data, menu, onScope, onUnmapped }: {
  scope: AskScope
  unmapped: boolean
  data: AskData | null
  menu: SingleDropdown<'model' | 'data'>
  onScope: (scope: AskScope) => void
  onUnmapped: (on: boolean) => void
}) {
  const words = scopeWords(scope, data, unmapped)
  const choose = (next: AskScope, close: boolean) => {
    onScope(next)
    remember(SCOPE_KEY, next)
    if (close) menu.close({ restoreFocus: true })
  }
  const components = Array.from(new Set((data?.platform ?? []).map((d) => d.component.name)))
  return (
    <div className="relative flex items-center gap-2 px-3 pt-2.5 text-xs text-ink-800">
      <span id="ask-about-label">Ask About</span>
      <button type="button" {...menu.triggerProps('data')} aria-describedby="ask-about-label"
        className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-control-md border border-line-control bg-surface px-2 text-sm text-ink-900 hover:bg-surface-hover">
        <SmallMark text={words.mark} />
        <span className="truncate font-semibold">{words.name}</span>
        {words.detail && <span className="truncate text-xs text-ink-700">{words.detail}</span>}
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
      </button>
      {menu.isOpen('data') && (
        <Popover label="Data to Ask About" width={380} {...menu.panelProps('data')} className="p-1.5">
          <MenuRow title="All My Data" detail="Every dataset you can report on" leading={<Mark text="ALL" />} selected={scope === 'all'} divider={false} onClick={() => choose('all', true)} />
          {data && data.platform.length > 0 && (
            <>
              <Section>C360</Section>
              <MenuRow title={`C360 ${components.join(' and ')}`} detail={listed(data.platform.map((d) => d.label))} leading={<Mark text="C360" />} selected={scope === 'platform'} divider={false}
                onClick={() => choose('platform', true)} />
            </>
          )}
          {data && data.databases.length > 0 && (
            <>
              <Section>Your Databases</Section>
              {data.databases.map((db) => {
                const chosen = scope === `db:${db.id}`
                return (
                  <div key={db.id}>
                    <MenuRow title={db.name} detail={`${db.engine_name} · ${db.datasets.length ? plural(db.datasets.length, 'mapped dataset') : 'nothing mapped yet'}`} leading={<Mark text={engineMark(db.engine)} />}
                      selected={chosen} divider={false} onClick={() => choose(`db:${db.id}`, false)} />
                    {chosen && (
                      <div className="mb-1.5 ml-[48px] flex flex-col gap-0.5 pr-2">
                        <Checkbox label="Also Look at Tables Not Mapped Yet" checked={unmapped} onChange={(event) => { onUnmapped(event.target.checked); remember(UNMAPPED_KEY, String(event.target.checked)) }} />
                        <span className="pl-6 text-xs text-ink-800">The names, and the columns of the tables your prompt mentions, read when you press Generate.</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
          {data && data.uploads.length > 0 && (
            <>
              <Section>Uploaded Files</Section>
              <MenuRow title="Uploaded Files" detail={listed(data.uploads.map((d) => d.label), 3)} leading={<Mark text="CSV" quiet />} trailing={<span className="text-xs text-ink-800">{plural(data.uploads.length, 'file')}</span>}
                selected={scope === 'uploads'} divider={false} onClick={() => choose('uploads', true)} />
            </>
          )}
        </Popover>
      )}
    </div>
  )
}

function Section({ children }: { children: string }) {
  return <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-800 uppercase">{children}</p>
}
