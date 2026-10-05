import { FileText, Megaphone, Route, Users, type LucideIcon } from 'lucide-react'

import type { HomeCapabilities, HomeViewer } from './data/types'

export interface CreateTile {
  key: 'campaign' | 'journey' | 'template' | 'list'
  label: string
  icon: LucideIcon
  to: string
}

/** The tiles this viewer may use: each needs its edit permission; Journey also needs the feature and a create flow. */
export function createNewTiles(viewer: HomeViewer, capabilities: HomeCapabilities): CreateTile[] {
  const tiles: (CreateTile & { allowed: boolean })[] = [
    { key: 'campaign', label: 'Campaign', icon: Megaphone, to: '/campaigns/new', allowed: viewer.can('campaign.edit') },
    { key: 'journey', label: 'Journey', icon: Route, to: '/journeys', allowed: viewer.can('journey.edit') && viewer.has('journeys') && capabilities.journeyCreateFlow },
    { key: 'template', label: 'Template', icon: FileText, to: '/templates/new', allowed: viewer.can('template.edit') },
    { key: 'list', label: 'Contact List', icon: Users, to: '/contact-lists?new=1', allowed: viewer.can('list.edit') },
  ]
  return tiles.filter((tile) => tile.allowed).map(({ allowed: _allowed, ...tile }) => tile)
}
