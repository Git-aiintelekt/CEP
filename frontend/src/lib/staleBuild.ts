/** A screen's code from an older build the server no longer has: C360 was upgraded while this page was open
 * (Chrome, Firefox and Safari word it differently). Not a fault of the screen, so not reported as one. */
export function isStaleBuild(error: Error | null): boolean {
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error?.message ?? '')
}
