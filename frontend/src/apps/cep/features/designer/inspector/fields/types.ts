/**
 * The contract every inspector field keeps.
 *
 * A drag has to cost one undo step, so live changes go out through onPreview and only the last one through
 * onCommit. null means clear the setting: the adapter turns that into removeAttributes, which is what both
 * "No colour" and Reset produce.
 */
import type { PersonalizationTag } from '@/lib/types'

/** What a field needs to offer the tag picker beside its input. Left out, there is no picker. */
export interface TagPickerSlot {
  tags: PersonalizationTag[]
  channel: string
  recent: string[]
  /** told which tag was chosen, so it can go to the top of the recent list */
  onPick?: (key: string) => void
}

export interface FieldContract {
  /** what this block sets itself, or null when it sets nothing */
  value: string | null
  /** what the recipient sees when the block sets nothing, shown as a placeholder */
  effective?: string | null
  /** every intermediate value of a drag or a held arrow key; never reaches the undo stack */
  onPreview?: (value: string) => void
  onCommit: (value: string | null) => void
  /** the interaction was abandoned (Escape): the value goes back to what it was */
  onCancel?: () => void
  disabled?: boolean
}

export interface LabelledField extends FieldContract {
  label: string
  /** true when the value on show comes from somewhere other than this block */
  inherited?: boolean
  /** overrides the wording of that note, which differs for the email's own settings and MJML's defaults */
  inheritedNote?: string
}

/** Any field's props: the shared contract plus whatever that field adds. */
export type Field<Extra = unknown> = LabelledField & Extra

export const INHERITED_NOTE = 'From email defaults'
export const EMAIL_SETTINGS_NOTE = "From your email's settings"
export const RESET_LABEL = 'Reset'
