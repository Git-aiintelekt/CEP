import { failureText } from '@/lib/saveFeedback'

/** What to tell the operator, in C360's words (lib/saveFeedback): the API's field messages when it sent any, otherwise what failed
 *  (`what`: "The file was not uploaded"), why, and what to do; a known problem's note too. */
export function problemText(error: unknown, what = ''): string {
  return failureText(error, what)
}
