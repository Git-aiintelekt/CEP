import { failureText } from '@/lib/saveFeedback'

/** What to tell the operator, in CEP's words (lib/saveFeedback): the API's field messages when it sent any, otherwise why it failed and what to do. */
export function problemText(error: unknown): string {
  return failureText(error)
}
