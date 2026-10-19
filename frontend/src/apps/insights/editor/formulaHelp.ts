/** The formula language's functions as the editor lists them (backend apps/insights/formula.py FUNCTIONS). */

export const FORMAT_LABEL: Record<string, string> = { '': 'Automatic', integer: 'Whole Number', decimal: 'Decimal', money: 'Money', percent: 'Percentage' }

export const SHARED_KIND_LABEL = { measure: 'Measure Formula', formula: 'Formula (Each Row)' } as const

export interface FormulaFunction { name: string; usage: string; words: string; measureOnly?: boolean
  /** what the button puts in, when not the name and an opening bracket */
  insert?: string }

export const FORMULA_FUNCTIONS: { group: string; items: FormulaFunction[] }[] = [
  { group: 'Adding Up', items: [
    { name: 'SUM', usage: 'SUM([Field], condition)', words: 'The total; with a condition, of the rows it holds for', measureOnly: true },
    { name: 'AVERAGE', usage: 'AVERAGE([Field], condition)', words: 'The average', measureOnly: true },
    { name: 'MIN', usage: 'MIN([Field], condition)', words: 'The smallest number, or the earliest date', measureOnly: true },
    { name: 'MAX', usage: 'MAX([Field], condition)', words: 'The largest number, or the latest date', measureOnly: true },
    { name: 'COUNT', usage: 'COUNT([Field], condition)', words: 'How many rows have a value', measureOnly: true },
    { name: 'DISTINCTCOUNT', usage: 'DISTINCTCOUNT([Field], condition)', words: 'How many different values', measureOnly: true },
    { name: 'COUNTROWS', usage: 'COUNTROWS(condition)', words: 'How many rows', measureOnly: true },
    { name: 'SUMX', usage: 'SUMX([Quantity] * [Price])', words: 'The total of a value worked out for each row (also AVERAGEX, MINX, MAXX, COUNTX)', measureOnly: true },
  ] },
  { group: 'Share, Rank and Time', items: [
    { name: 'CALCULATE', usage: 'CALCULATE(SUM([Field]), ALL([Channel]))', words: 'With ALL, the total across every value of a field: the parent of a share', measureOnly: true },
    { name: 'ALL', usage: 'ALL([Field], …)', words: 'Inside CALCULATE: ignore these fields of the report (none named: all of them)', measureOnly: true },
    { name: 'RANKX', usage: 'RANKX(SUM([Field]), "asc")', words: 'The row\'s place, 1 for the largest (asc: the smallest); a measure of its own', measureOnly: true },
    { name: 'TOTALYTD', usage: 'TOTALYTD(SUM([Field]))', words: 'Year to date, from your fiscal year\'s start; needs a date in the report', measureOnly: true },
    { name: 'TOTALQTD', usage: 'TOTALQTD(SUM([Field]))', words: 'Quarter to date', measureOnly: true },
    { name: 'SAMEPERIODLASTYEAR', usage: 'SAMEPERIODLASTYEAR(SUM([Field]))', words: 'The same month, quarter or week a year before', measureOnly: true },
    { name: 'PREVIOUSPERIOD', usage: 'PREVIOUSPERIOD(SUM([Field]))', words: 'The period before, at the report\'s date grouping', measureOnly: true },
    { name: 'PARALLELPERIOD', usage: 'PARALLELPERIOD(SUM([Field]), -3, "month")', words: 'Moved by months, quarters or years (minus: earlier)', measureOnly: true },
  ] },
  { group: 'Naming Parts', items: [
    { name: 'VAR', usage: 'VAR Sent = SUM([Sent Count]) RETURN …', words: 'Name a part once and use it by name after RETURN', insert: 'VAR  = \nRETURN ' },
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
    { name: 'INT', usage: 'INT(number)', words: 'The whole number, rounded down' },
    { name: 'MOD', usage: 'MOD(number, divisor)', words: 'The remainder' },
    { name: 'POWER', usage: 'POWER(number, power)', words: 'Raised to a power' },
    { name: 'SQRT', usage: 'SQRT(number)', words: 'The square root' },
    { name: 'EXP', usage: 'EXP(number)', words: 'e to the power' },
    { name: 'LN', usage: 'LN(number)', words: 'The natural logarithm' },
    { name: 'LOG', usage: 'LOG(number, base)', words: 'The logarithm, base 10 unless given' },
    { name: 'SIGN', usage: 'SIGN(number)', words: '1, 0 or -1' },
    { name: 'VALUE', usage: 'VALUE(text)', words: 'Text as a number (empty when it is not one)' },
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
    { name: 'REPLACE', usage: 'REPLACE(text, "old", "new")', words: 'With every old part replaced (also SUBSTITUTE)' },
    { name: 'MID', usage: 'MID(text, start, count)', words: 'The letters from a place, the first is 1' },
    { name: 'FIND', usage: 'FIND("part", text)', words: 'Where the part starts, 0 when it is not there' },
    { name: 'TEXT', usage: 'TEXT(value)', words: 'A number or a date as text' },
  ] },
  { group: 'Dates', items: [
    { name: 'YEAR', usage: 'YEAR([Date])', words: 'The year, in your time zone' },
    { name: 'MONTH', usage: 'MONTH([Date])', words: 'The month, 1 to 12' },
    { name: 'DAY', usage: 'DAY([Date])', words: 'The day of the month' },
    { name: 'QUARTER', usage: 'QUARTER([Date])', words: 'The quarter, 1 to 4' },
    { name: 'WEEKDAY', usage: 'WEEKDAY([Date])', words: 'The day of the week, 1 for Sunday' },
    { name: 'WEEKNUM', usage: 'WEEKNUM([Date])', words: 'The week of the year (ISO weeks, from Monday)' },
    { name: 'HOUR', usage: 'HOUR([Date and Time])', words: 'The hour, 0 to 23' },
    { name: 'EOMONTH', usage: 'EOMONTH([Date], months)', words: 'The last day of the month, moved by months' },
    { name: 'DATE', usage: 'DATE(2026, 12, 31)', words: 'A date from a year, a month and a day' },
    { name: 'TODAY', usage: 'TODAY()', words: "Today's date" },
    { name: 'NOW', usage: 'NOW()', words: 'The date and time now' },
    { name: 'DATEDIFF', usage: 'DATEDIFF(start, end, "day")', words: 'Days, months or years between two dates' },
    { name: 'DATEADD', usage: 'DATEADD([Date], 30, "day")', words: 'A date moved by days, months or years' },
  ] },
]

/** the text with the function's usage put in at the cursor (a field name left for the person to pick) */
export function insertAt(text: string, at: number, piece: string): { text: string; cursor: number } {
  return { text: text.slice(0, at) + piece + text.slice(at), cursor: at + piece.length }
}
