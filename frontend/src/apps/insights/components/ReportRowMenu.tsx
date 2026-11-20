/** The ⋯ on a row of Insights → Reports: Open, Edit, Duplicate, Move to Folder, Share, Schedule and Delete, each only for whoever may. */
import { CalendarClock, Copy, ExternalLink, FolderInput, Pencil, Share2, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ReportSummary } from '../types'
import { RowMenu } from './RowMenu'

export type RowAction = 'open' | 'edit' | 'duplicate' | 'folder' | 'share' | 'schedule' | 'delete'

const icon = (Icon: typeof Pencil) => <Icon size={16} strokeWidth={1.5} aria-hidden />

/** canShare: the owner or a report administrator (the list does not send can_share; the API checks it again) */
export function ReportRowMenu({ report, canCreate, canShare, scheduled, onAction }: { report: ReportSummary; canCreate: boolean; canShare: boolean; scheduled: boolean; onAction: (action: RowAction) => void }) {
  const item = (action: RowAction, title: string, leading: ReactNode, tone?: 'error') => ({ title, icon: leading, tone, onSelect: () => onAction(action) })
  return (
    <RowMenu label={`Actions for ${report.name}`} groups={[
      [item('open', 'Open', icon(ExternalLink)), report.can_edit && item('edit', 'Edit', icon(Pencil)), canCreate && item('duplicate', 'Duplicate', icon(Copy)), report.can_edit && item('folder', 'Move to Folder…', icon(FolderInput))],
      [canShare && item('share', 'Share…', icon(Share2)), canCreate && item('schedule', scheduled ? 'Change Schedule…' : 'Schedule…', icon(CalendarClock))],
      [report.can_edit && item('delete', 'Delete…', <Trash2 size={16} strokeWidth={1.5} aria-hidden className="text-danger-text" />, 'error')],
    ]} />
  )
}
