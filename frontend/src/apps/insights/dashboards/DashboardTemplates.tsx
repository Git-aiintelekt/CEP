/**
 * Insights → Dashboards' blue Dashboard Templates panel (docs/mockups/dashboards.html, like the Journeys page's): Start from
 * Scratch, then the dashboards the Base Reports packs add, at most four (View More only when there are more). A card opens a
 * read-only preview; Use This Template opens Add Base Reports on its pack, since a pack's dashboards come with the pack.
 * The packs list only the dashboards' names, so a card draws a generic tile picture (docs/requests/backend-dashboard-templates.md).
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, LayoutDashboard, Mails, MessageSquare, type LucideIcon } from 'lucide-react'

import { BAND_CARD, ROUND_ARROW, ScratchCard } from '@/apps/cep/features/journeys/templates/TemplateCards'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { formatDate } from '@/lib/format'
import { baseReportsApi } from '../api'
import type { BasePack } from '../types'

const SHOWN = 4

export interface DashboardTemplate { name: string; pack: BasePack }

/** the pack's channel, from its key: the tag on the card */
function channelOf(pack: BasePack): { label: string; icon: LucideIcon } | null {
  if (/sms/i.test(pack.key)) return { label: 'SMS', icon: MessageSquare }
  if (/email/i.test(pack.key)) return { label: 'Email', icon: Mails }
  return null
}

function addedWords(pack: BasePack): string {
  return pack.added[0] ? `Added ${formatDate(pack.added[0].at)} · ${pack.name}` : `From ${pack.name}`
}

/** a few tiles: four numbers over a wide chart and a narrow one */
function TilePicture() {
  return (
    <span aria-hidden className="grid w-26 grid-cols-4 grid-rows-[10px_20px] gap-[3px]">
      {[0, 1, 2, 3].map((i) => <span key={i} className="rounded-xs bg-brand-100" />)}
      <span className="col-span-3 rounded-xs bg-plum-200" />
      <span className="rounded-xs bg-fill-muted" />
    </span>
  )
}

function TemplateCard({ template, onClick }: { template: DashboardTemplate; onClick: () => void }) {
  const channel = channelOf(template.pack)
  return (
    <button type="button" onClick={onClick} aria-label={template.name} className={`${BAND_CARD} hover:bg-surface-hover active:bg-fill-subtle`}>
      <span className="flex h-[88px] w-full shrink-0 flex-col justify-between bg-surface-subtle px-4 py-3">
        {channel ? (
          <span className="inline-flex h-[22px] items-center gap-1 self-start rounded-sm border border-line-subtle bg-surface px-1.5 text-xs font-semibold text-ink-800">
            <channel.icon size={14} strokeWidth={1.5} aria-hidden />{channel.label}
          </span>
        ) : <span />}
        <TilePicture />
      </span>
      <span className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <span className="flex items-start justify-between gap-2">
          <span className="text-card-title font-semibold text-ink-900">{template.name}</span>
          <span aria-hidden className={ROUND_ARROW}><ArrowRight size={14} strokeWidth={1.5} /></span>
        </span>
        <span className="line-clamp-2 text-helper text-ink-800">{addedWords(template.pack)}</span>
      </span>
    </button>
  )
}

function useDashboardTemplates() {
  const catalog = useQuery({ queryKey: ['insights', 'base-reports'], queryFn: ({ signal }) => baseReportsApi.list(signal) })
  const templates: DashboardTemplate[] = (catalog.data?.packs ?? []).flatMap((pack) => pack.contents.dashboards.map((name) => ({ name, pack })))
  return { catalog, templates }
}

export function DashboardTemplatesPanel({ onScratch, onPreview, onViewMore }: {
  /** absent for someone who cannot create a dashboard */
  onScratch?: () => void
  onPreview: (template: DashboardTemplate) => void
  onViewMore: () => void
}) {
  const { catalog, templates } = useDashboardTemplates()
  return (
    <section aria-labelledby="dashboard-templates-title" className="rounded-lg bg-band px-[clamp(20px,2vw,32px)] pt-6 pb-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="dashboard-templates-title" className="font-display text-section-title font-semibold text-on-brand">Dashboard Templates</h2>
        {templates.length > SHOWN && (
          <button type="button" onClick={onViewMore}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control-md bg-surface-overlay px-3 text-sm font-semibold text-link transition-colors duration-fast ease-standard hover:bg-brand-100 hover:text-link-hover active:bg-brand-100">
            View More <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
      <ul aria-label="Start a Dashboard" className="mt-5 grid auto-cols-[minmax(192px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-1">
        {onScratch && <li className="min-w-0"><ScratchCard onClick={onScratch} hint="An empty dashboard. You choose the reports and the period." /></li>}
        {catalog.isPending && (
          <li className="flex min-h-[176px] items-center justify-center gap-2 rounded-lg bg-surface text-sm text-ink-800"><Spinner size="sm" /> Loading the templates</li>
        )}
        {catalog.isError && (
          <li className="flex min-h-[176px] items-center justify-center rounded-lg bg-surface px-4 text-center text-sm text-ink-800">The templates could not be loaded.</li>
        )}
        {templates.slice(0, SHOWN).map((template) => (
          <li key={`${template.pack.key}:${template.name}`} className="min-w-0"><TemplateCard template={template} onClick={() => onPreview(template)} /></li>
        ))}
      </ul>
    </section>
  )
}

/** View More: every template, when the packs offer more than the panel shows */
export function DashboardTemplatesGallery({ onClose, onPreview }: { onClose: () => void; onPreview: (template: DashboardTemplate) => void }) {
  const { templates } = useDashboardTemplates()
  return (
    <Modal title="Dashboard Templates" subtitle="Ready-made dashboards from the Base Reports packs, added as your own copies." onClose={onClose} size="lg" scrollBody>
      <ul aria-label="Dashboard Templates" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {templates.map((template) => (
          <li key={`${template.pack.key}:${template.name}`} className="min-w-0 rounded-lg border border-line"><TemplateCard template={template} onClick={() => onPreview(template)} /></li>
        ))}
      </ul>
    </Modal>
  )
}

function Contents({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-ink-900">{title} <span className="cep-num font-normal text-ink-800">{items.length}</span></h3>
      <ul className="flex flex-col gap-1">
        {items.map((item) => <li key={item} className="text-sm text-ink-800">{item}</li>)}
      </ul>
    </section>
  )
}

/** a template, read only: where it comes from and what adding it brings */
export function DashboardTemplatePreview({ template, canCreate, onClose, onUse }: { template: DashboardTemplate; canCreate: boolean; onClose: () => void; onUse: () => void }) {
  const { pack } = template
  const footer = (
    <>
      <Button onClick={onClose}>{canCreate ? 'Cancel' : 'Close'}</Button>
      {canCreate && <Button variant="primary" onClick={onUse}>Use This Template</Button>}
    </>
  )
  return (
    <Modal title={template.name} subtitle={addedWords(pack)} onClose={onClose} footer={footer}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4 rounded-md border border-line-subtle bg-surface-subtle p-4">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-800"><LayoutDashboard size={20} strokeWidth={1.5} /></span>
          <p className="text-sm text-ink-900">{pack.summary}</p>
        </div>
        <p className="text-sm text-ink-800">
          It comes with the {pack.name} pack, which reads {pack.needs.label}. Adding the pack makes your own copies of all of it; later versions never change them.
          {pack.added[0] && ' It is added already: adding it again makes new copies.'}
        </p>
        <div className="grid gap-5 sm:grid-cols-3">
          <Contents title="Dashboards" items={pack.contents.dashboards} />
          <Contents title="Reports" items={pack.contents.reports} />
          <Contents title="Datasets" items={pack.contents.datasets} />
        </div>
      </div>
    </Modal>
  )
}
