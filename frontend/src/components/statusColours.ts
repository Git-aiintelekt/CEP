/**
 * Each lifecycle status has its own tag colour (the --color-tag-* tokens); Archived is the only unfilled tag, a dashed outline.
 * Only live statuses (Active, Sending, Preparing) carry the dot; unknown statuses fall back to neutral grey.
 */
type TagColour = 'draft' | 'test-published' | 'production-published' | 'scheduled' | 'active' | 'completed' | 'paused' | 'failed' | 'archived' | 'neutral'

const COLOURS: Record<TagColour, string> = {
  draft: 'bg-tag-draft-bg text-tag-draft-text',
  'test-published': 'bg-tag-test-published-bg text-tag-test-published-text',
  'production-published': 'bg-tag-production-published-bg text-tag-production-published-text',
  scheduled: 'bg-tag-scheduled-bg text-tag-scheduled-text',
  active: 'bg-tag-active-bg text-tag-active-text',
  completed: 'bg-tag-completed-bg text-tag-completed-text',
  paused: 'bg-tag-paused-bg text-tag-paused-text',
  failed: 'bg-tag-failed-bg text-tag-failed-text',
  archived: 'border border-dashed border-tag-archived-border bg-tag-archived-bg text-tag-archived-text',
  neutral: 'bg-fill-subtle text-ink-800',
}

const STATUS_COLOUR: Record<string, TagColour> = {
  DRAFT: 'draft',
  TEST_PUBLISHED: 'test-published',
  PRODUCTION_PUBLISHED: 'production-published',
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  SENDING: 'active',
  PREPARING: 'active',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  FAILED: 'failed',
  CANCELLED: 'failed',
  ARCHIVED: 'archived',
  PRODUCTION: 'production-published', // contact list type
  TEST: 'test-published', // contact list type
  APPROVED: 'scheduled', // journey status: approved and live now or at scheduled_activate_at — the "Scheduled" tag colour
}

/** The background and text (and Archived's dashed border) for a status, for anything else coloured by status. */
export function statusColours(status: string): string {
  return COLOURS[STATUS_COLOUR[status] ?? 'neutral']
}
