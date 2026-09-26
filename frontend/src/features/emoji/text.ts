/** Length as people and the server count it: code points, so an emoji is one character, not the two UTF-16 units JavaScript's .length reports. */
export const charCount = (value: string): number => Array.from(value).length
