/** A link for an email: a web address, a mailto:, a tel:, an in-page anchor, or a personalization tag. */
import { TextField } from './TextField'
import { linkError } from './link'
import type { Field, TagPickerSlot } from './types'

export function LinkField(props: Field<{ tagPicker?: TagPickerSlot }>) {
  return <TextField {...props} validate={linkError} />
}
