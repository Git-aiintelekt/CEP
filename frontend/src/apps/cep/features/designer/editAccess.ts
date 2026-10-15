/** Who may change a template's design, the MJML included: the edit permission, on a template that is not archived nor locked by a live drip. */
import type { PermissionCode } from '@/lib/types'

export function canEditTemplate(can: (permission: PermissionCode) => boolean, status: string, lockedByDrip = false): boolean {
  // the server refuses to save an archived or drip-locked template whoever asks, so nobody is offered the chance
  return can('template.edit') && status !== 'ARCHIVED' && !lockedByDrip
}
