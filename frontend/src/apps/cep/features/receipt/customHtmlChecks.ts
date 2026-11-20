/** The checks a Custom HTML receipt passes before it saves: the server's design.receipt_content_errors, plus one warning. */
import { ITEM_TAG, RECEIPT_ITEMS } from './registerSettings'

export interface CustomHtmlValue {
  custom_html: string | null
  custom_css: string | null
  item_row: string | null
}

const UNSAFE = /<\s*(script|form|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript:/i

export interface CustomHtmlCheck {
  ok: boolean
  /** a warning saves; a failure does not */
  warning?: boolean
  title: string
  detail?: string
}

/** The checks the server makes before it saves, plus a warning about a discount nobody will see. */
export function customHtmlChecks({ custom_html, custom_css, item_row }: CustomHtmlValue): CustomHtmlCheck[] {
  const html = custom_html ?? ''
  const row = (item_row ?? '').trim()
  const slots = html.match(RECEIPT_ITEMS)?.length ?? 0
  const checks: CustomHtmlCheck[] = [{ ok: html.trim().length > 0, title: 'The receipt has HTML.' }]
  if (row) checks.push({ ok: slots === 1, title: 'The Receipt has {{receipt_items}} once,', detail: 'where the item rows go.' })
  else checks.push({ ok: true, warning: true, title: 'No Item Row:', detail: '{{receipt_body}} still gives the built-in item table.' })
  checks.push({ ok: !new RegExp(ITEM_TAG.source).test(html), title: 'Item tags only in the Item Row.' })
  checks.push({ ok: !UNSAFE.test(html) && !UNSAFE.test(row) && !UNSAFE.test(custom_css ?? ''), title: 'Email-safe:', detail: 'no scripts, forms, frames or event handlers.' })
  if (row && !/\{\{\s*item\.discount\s*\}\}/.test(row)) checks.push({ ok: false, warning: true, title: '{{item.discount}} is not shown.', detail: 'Lines with a discount will not say so. Fine if that is intended.' })
  return checks
}
