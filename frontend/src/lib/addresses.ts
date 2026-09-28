/** "a@x.example, b@y.example" or one per line -> the addresses, trimmed, without empties or repeats */
export function addressesOf(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))]
}
