import { ApiError } from '@/lib/api'

/** What to tell the operator: the API's field messages when it sent any, otherwise its summary. */
export function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.values(error.fieldErrors)
    return fields.length > 0 ? fields.join(' ') : error.message
  }
  return error instanceof Error ? error.message : 'The request did not complete. Check the connection and try again.'
}
