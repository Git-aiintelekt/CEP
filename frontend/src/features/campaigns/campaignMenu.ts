/** The ⋮ actions a campaign offers: one list for the table row and the preview pop-up, so the two never disagree, and the campaign page header's. */
import { Archive, ArchiveRestore, ArrowRight, ChartColumn, Copy, FlaskConical, Pause, Play, Send, Settings2, Workflow, X, type LucideIcon } from 'lucide-react'

import type { Campaign } from '@/lib/types'

import { setupHref, type SetupPlace } from './setupFlow'
import type { StatusAction } from './useCampaignAction'
import { campaignHome, hasAction } from './vocabulary'

export type CampaignMenuItem = { key: string; label: string; icon: LucideIcon } & ({ to: string; action?: never } | { action: StatusAction; to?: never })

export function campaignMenuItems(campaign: Campaign, can: { edit: boolean; publish: boolean }): CampaignMenuItem[] {
  const own = !campaign.is_journey_generated
  const items: (CampaignMenuItem | false)[] = [
    can.edit && own && !campaign.setup_complete && hasAction(campaign, 'edit') && { key: 'continue-setup', label: 'Continue Setup', icon: Play, to: campaignHome(campaign, can.edit) },
    can.edit && own && campaign.setup_complete && hasAction(campaign, 'edit') && { key: 'edit', label: 'Edit', icon: Settings2, to: `/campaigns/${campaign.id}/edit` },
    // there is no journey page of its own yet
    !own && { key: 'view-journey', label: 'View Journey', icon: Workflow, to: '/journeys' },
    hasAction(campaign, 'results') && { key: 'view-results', label: 'View Results', icon: ChartColumn, to: `/campaigns/${campaign.id}?tab=performance` },
    can.edit && hasAction(campaign, 'clone') && { key: 'clone', label: 'Clone', icon: Copy, action: 'clone' },
    can.publish && hasAction(campaign, 'pause') && { key: 'pause', label: 'Pause', icon: Pause, action: 'pause' },
    can.publish && hasAction(campaign, 'resume') && { key: 'resume', label: 'Resume', icon: Play, action: 'resume' },
    can.publish && hasAction(campaign, 'cancel_schedule') && { key: 'cancel-schedule', label: 'Cancel Schedule', icon: X, action: 'cancel-schedule' },
    can.edit && hasAction(campaign, 'archive') && { key: 'archive', label: 'Archive', icon: Archive, action: 'archive' },
    can.edit && hasAction(campaign, 'unarchive') && { key: 'unarchive', label: 'Unarchive', icon: ArchiveRestore, action: 'unarchive' },
  ]
  return items.filter((item): item is CampaignMenuItem => Boolean(item))
}

export interface CampaignMainAction {
  key: string
  label: string
  icon: LucideIcon
  /** the icon goes after the label */
  iconAfter?: boolean
  /** a small line under the button */
  hint?: string
  to?: string
  action?: StatusAction
  /** opens in a new tab */
  external?: boolean
}

export type CampaignPageMenuItem = CampaignMenuItem | { key: string; label: string; icon: LucideIcon; command: 'copy-id' | 'edit-details'; to?: never; action?: never }

/**
 * The campaign page's header: one main button, Clone, and the rest under ⋮. Every action the old row of buttons offered
 * is here under the same rules. `editPlace` is the part of the setup that holds what the tab in view shows.
 */
export function campaignPageActions(campaign: Campaign, can: { edit: boolean; publish: boolean }, editPlace: SetupPlace | 'details') {
  const own = !campaign.is_journey_generated
  const edit = can.edit && own
  const publish = can.publish && own
  const testPublish = edit && hasAction(campaign, 'test_publish')
  const productionPublish = publish && hasAction(campaign, 'publish')
  const resume = publish && hasAction(campaign, 'resume')

  const main: CampaignMainAction | null =
    !own ? { key: 'view-journey', label: 'View Journey', icon: Workflow, to: '/journeys', external: true }
    : resume ? { key: 'resume', label: 'Resume', icon: Play, action: 'resume' }
    : campaign.status === 'DRAFT' && testPublish ? { key: 'continue-setup', label: 'Continue Setup', icon: ArrowRight, iconAfter: true, hint: 'Next: send a test', to: setupHref(campaign.id, { step: 'test' }) }
    : productionPublish ? { key: 'production-publish', label: 'Production Publish', icon: Send, to: setupHref(campaign.id, { step: 'publish', section: 'review' }) }
    : null

  const menu: (CampaignPageMenuItem | false)[] = [
    edit && hasAction(campaign, 'edit') && (editPlace === 'details'
      ? { key: 'edit', label: 'Edit Campaign', icon: Settings2, command: 'edit-details' as const }
      : { key: 'edit', label: 'Edit Campaign', icon: Settings2, to: setupHref(campaign.id, editPlace) }),
    testPublish && main?.key !== 'continue-setup' && { key: 'test-publish', label: 'Send a Test', icon: FlaskConical, to: setupHref(campaign.id, { step: 'test' }) },
    productionPublish && main?.key !== 'production-publish' && { key: 'production-publish', label: 'Production Publish', icon: Send, to: setupHref(campaign.id, { step: 'publish', section: 'review' }) },
    publish && hasAction(campaign, 'pause') && { key: 'pause', label: 'Pause', icon: Pause, action: 'pause' },
    publish && hasAction(campaign, 'cancel_schedule') && { key: 'cancel-schedule', label: 'Cancel Schedule', icon: X, action: 'cancel-schedule' },
    edit && hasAction(campaign, 'archive') && { key: 'archive', label: 'Archive', icon: Archive, action: 'archive' },
    edit && hasAction(campaign, 'unarchive') && { key: 'unarchive', label: 'Unarchive', icon: ArchiveRestore, action: 'unarchive' },
    Boolean(campaign.code) && { key: 'copy-id', label: 'Copy Campaign ID', icon: Copy, command: 'copy-id' },
  ]

  return {
    main,
    clone: edit && hasAction(campaign, 'clone'),
    menu: menu.filter((item): item is CampaignPageMenuItem => Boolean(item)),
  }
}
