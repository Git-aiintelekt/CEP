/** The formula language's functions as the editor lists them (backend apps/insights/formula.py FUNCTIONS). */

export const FORMAT_LABEL: Record<string, string> = { '': 'Automatic', integer: 'Whole Number', decimal: 'Decimal', money: 'Money', percent: 'Percentage' }

export interface FormulaFunction { name: string; usage: string; words: string; measureOnly?: boolean }

export const FORMULA_FUNCTIONS: { group: string; items: FormulaFunction[] }[] = [
  { group: 'Adding Up', items: [
    { name: 'SUM', usage: 'SUM([Field], condition)', words: 'The total; with a condition, of the rows it holds for', measureOnly: true },
    { name: 'AVERAGE', usage: 'AVERAGE([Field], condition)', words: 'The average', measureOnly: true },
    { name: 'MIN', usage: 'MIN([Field], condition)', words: 'The smallest number, or the earliest date', measureOnly: true },
    { name: 'MAX', usage: 'MAX([Field], condition)', words: 'The largest number, or the latest date', measureOnly: true },
    { name: 'COUNT', usage: 'COUNT([Field], condition)', words: 'How many rows have a value', measureOnly: true },
    { name: 'DISTINCTCOUNT', usage: 'DISTINCTCOUNT([Field], condition)', words: 'How many different values', measureOnly: true },
    { name: 'COUNTROWS', usage: 'COUNTROWS(condition)', words: 'How many rows', measureOnly: true },
  ] },
  { group: 'Logic', items: [
    { name: 'IF', usage: 'IF(condition, then, else)', words: 'One value or another' },
    { name: 'SWITCH', usage: 'SWITCH([Field], value, result, …, else)', words: 'The result for the first value that matches' },
    { name: 'ISBLANK', usage: 'ISBLANK([Field])', words: 'Whether a value is empty' },
    { name: 'COALESCE', usage: 'COALESCE([Field], 0)', words: 'The first value that is not empty' },
  ] },
  { group: 'Numbers', items: [
    { name: 'DIVIDE', usage: 'DIVIDE(a, b, if zero)', words: 'a ÷ b, empty (or the third value) when b is 0' },
    { name: 'ROUND', usage: 'ROUND(number, places)', words: 'Rounded to the places given' },
    { name: 'ABS', usage: 'ABS(number)', words: 'Without its sign' },
    { name: 'FLOOR', usage: 'FLOOR(number)', words: 'Rounded down' },
    { name: 'CEILING', usage: 'CEILING(number)', words: 'Rounded up' },
  ] },
  { group: 'Text', items: [
    { name: 'CONCAT', usage: 'CONCAT(a, b, …)', words: 'Joined together, like a & b' },
    { name: 'UPPER', usage: 'UPPER(text)', words: 'In capitals' },
    { name: 'LOWER', usage: 'LOWER(text)', words: 'In small letters' },
    { name: 'TRIM', usage: 'TRIM(text)', words: 'Without spaces at either end' },
    { name: 'LEFT', usage: 'LEFT(text, count)', words: 'The first letters' },
    { name: 'RIGHT', usage: 'RIGHT(text, count)', words: 'The last letters' },
    { name: 'LEN', usage: 'LEN(text)', words: 'How many letters' },
    { name: 'CONTAINS', usage: 'CONTAINS(text, "part")', words: 'Whether it holds the part, in any case' },
    { name: 'REPLACE', usage: 'REPLACE(text, "old", "new")', words: 'With every old part replaced' },
    { name: 'TEXT', usage: 'TEXT(value)', words: 'A number or a date as text' },
  ] },
  { group: 'Dates', items: [
    { name: 'YEAR', usage: 'YEAR([Date])', words: 'The year, in your time zone' },
    { name: 'MONTH', usage: 'MONTH([Date])', words: 'The month, 1 to 12' },
    { name: 'DAY', usage: 'DAY([Date])', words: 'The day of the month' },
    { name: 'TODAY', usage: 'TODAY()', words: "Today's date" },
    { name: 'DATEDIFF', usage: 'DATEDIFF(start, end, "day")', words: 'Days, months or years between two dates' },
    { name: 'DATEADD', usage: 'DATEADD([Date], 30, "day")', words: 'A date moved by days, months or years' },
  ] },
]

/** the text with the function's usage put in at the cursor (a field name left for the person to pick) */
export function insertAt(text: string, at: number, piece: string): { text: string; cursor: number } {
  return { text: text.slice(0, at) + piece + text.slice(at), cursor: at + piece.length }
}
