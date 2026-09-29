/**
 * A Custom HTML block's layout: width, alignment, margin, padding and background. MJML gives an mj-raw no
 * attributes, so these live in the markup itself, in a wrapper table the block owns:
 *
 *   <table class="cep-html" width="100%">           the block, full width
 *     <tr><td align="…" style="padding:MARGIN">      the space outside, and where the content sits
 *       <table width="WIDTH">                          the content's width, px or %
 *         <tr><td style="padding:PADDING;background-color:BACKGROUND">
 *           …the person's HTML…
 *
 * The HTML field edits what is inside; a block that has no wrapper yet is wrapped the first time a setting is set,
 * and one that never gets a setting stays exactly as it was written.
 *
 * MJML passes an mj-raw through without its css-class, so Hide on Phones / Hide on Desktop would never reach the email:
 * the wrapper table carries those classes as well, mirrored from the block whenever it is written.
 */
import type { Component } from 'grapesjs'

import { HIDE_DESKTOP_CLASS, HIDE_MOBILE_CLASS, hasCssClass } from '../blocks/register'

export const CUSTOM_HTML_CLASS = 'cep-html'
export const CUSTOM_WIDTH_KEY = 'cep-html-width'
export const CUSTOM_ALIGN_KEY = 'cep-html-align'
export const CUSTOM_MARGIN_KEY = 'cep-html-margin'
export const CUSTOM_PADDING_KEY = 'cep-html-padding'
export const CUSTOM_BACKGROUND_KEY = 'cep-html-background'
export const CUSTOM_HTML_KEYS = [CUSTOM_WIDTH_KEY, CUSTOM_ALIGN_KEY, CUSTOM_MARGIN_KEY, CUSTOM_PADDING_KEY, CUSTOM_BACKGROUND_KEY] as const

export const isCustomHtmlKey = (key: string): boolean => (CUSTOM_HTML_KEYS as readonly string[]).includes(key)

export interface CustomHtmlLayout {
  width: string | null
  /** left or right; centred is the default and is never stored */
  align: 'left' | 'right' | null
  margin: string | null
  padding: string | null
  background: string | null
}

const EMPTY: CustomHtmlLayout = { width: null, align: null, margin: null, padding: null, background: null }

const TABLE_ATTRIBUTES = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'

function styleOf(element: Element | null, property: string): string | null {
  const style = element?.getAttribute('style') ?? ''
  const found = style.split(';').map((part) => part.trim().split(/\s*:\s*/)).find(([name]) => name?.toLowerCase() === property)
  const value = found?.[1]?.trim()
  return value ? value : null
}

/** The wrapper and its parts, when the markup carries one. */
function parse(html: string): { layout: CustomHtmlLayout; inner: string } | null {
  if (typeof DOMParser === 'undefined' || !html.includes(CUSTOM_HTML_CLASS)) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const outer = doc.body.firstElementChild
  if (!outer || outer.tagName !== 'TABLE' || !outer.classList.contains(CUSTOM_HTML_CLASS)) return null
  const outerCell = outer.querySelector(':scope > tbody > tr > td, :scope > tr > td')
  const innerTable = outerCell?.querySelector(':scope > table')
  const innerCell = innerTable?.querySelector(':scope > tbody > tr > td, :scope > tr > td')
  if (!outerCell || !innerTable || !innerCell) return null
  const align = outerCell.getAttribute('align')
  const width = innerTable.getAttribute('width')
  return {
    layout: {
      width: width === '100%' ? null : width,                                     // the full width is the default, so it reads as nothing set
      align: align === 'left' || align === 'right' ? align : null,             // centred is the default, so it reads as nothing set
      margin: styleOf(outerCell, 'padding'),
      padding: styleOf(innerCell, 'padding'),
      background: styleOf(innerCell, 'background-color'),
    },
    inner: innerCell.innerHTML.trim(),
  }
}

/** The block's visibility classes, which the wrapper must carry for the email to see them. */
export function hideClassesOf(component: Component): string[] {
  return [HIDE_MOBILE_CLASS, HIDE_DESKTOP_CLASS].filter((name) => hasCssClass(component, name))
}

/** The wrapper written out again around `inner`; none at all when nothing is set, so an untouched block stays as typed. */
export function wrap(layout: CustomHtmlLayout, inner: string, classes: string[] = []): string {
  if (Object.values(layout).every((value) => value === null) && classes.length === 0) return inner
  const outerStyle = layout.margin ? ` style="padding:${layout.margin};"` : ''
  const width = layout.width ?? '100%'
  const innerStyle = [layout.padding ? `padding:${layout.padding};` : '', layout.background ? `background-color:${layout.background};` : ''].join('')
  return (
    `<table class="${[CUSTOM_HTML_CLASS, ...classes].join(' ')}" ${TABLE_ATTRIBUTES} width="100%"><tr><td align="${layout.align ?? 'center'}"${outerStyle}>` +
    `<table ${TABLE_ATTRIBUTES} width="${width}" style="width:${width};max-width:100%;"><tr><td${innerStyle ? ` style="${innerStyle}"` : ''}>` +
    `${inner}</td></tr></table></td></tr></table>`
  )
}

function markupOf(component: Component): string {
  const read = (component as { getInnerHTML?: () => string }).getInnerHTML
  return typeof read === 'function' ? read.call(component).trim() : ''
}

/** What the block holds: its layout (all null without a wrapper) and the HTML the person wrote. */
export function customHtmlOf(component: Component): { layout: CustomHtmlLayout; inner: string } {
  const html = markupOf(component)
  return parse(html) ?? { layout: { ...EMPTY }, inner: html }
}

export function readCustomHtml(component: Component, key: string): string | null {
  const { layout } = customHtmlOf(component)
  switch (key) {
    case CUSTOM_WIDTH_KEY: return layout.width
    case CUSTOM_ALIGN_KEY: return layout.align
    case CUSTOM_MARGIN_KEY: return layout.margin
    case CUSTOM_PADDING_KEY: return layout.padding
    case CUSTOM_BACKGROUND_KEY: return layout.background
    default: return null
  }
}

/** Writes one setting and puts the wrapper back around the same inner HTML. Refuses a value MJML-style rules would. */
export function writeCustomHtml(component: Component, key: string, value: string | null): boolean {
  const { layout, inner } = customHtmlOf(component)
  const next = { ...layout }
  const trimmed = value?.trim() || null
  if (key === CUSTOM_WIDTH_KEY) {
    if (trimmed !== null && !/^\d+(\.\d+)?(px|%)$/.test(trimmed)) return false
    next.width = trimmed === '100%' ? null : trimmed
  } else if (key === CUSTOM_ALIGN_KEY) {
    if (trimmed !== null && trimmed !== 'left' && trimmed !== 'center' && trimmed !== 'right') return false
    next.align = trimmed === 'center' ? null : (trimmed as CustomHtmlLayout['align'])
  } else if (key === CUSTOM_MARGIN_KEY || key === CUSTOM_PADDING_KEY) {
    if (trimmed !== null && !/^(\d+(\.\d+)?(px|%)\s*){1,4}$/.test(trimmed)) return false
    if (key === CUSTOM_MARGIN_KEY) next.margin = trimmed
    else next.padding = trimmed
  } else if (key === CUSTOM_BACKGROUND_KEY) {
    if (trimmed !== null && !/^#[0-9a-f]{6}$/i.test(trimmed)) return false
    next.background = trimmed?.toLowerCase() ?? null
  } else {
    return false
  }
  component.components(wrap(next, inner, hideClassesOf(component)))
  return true
}

/** The person's own markup, without the wrapper. */
export function readCustomHtmlMarkup(component: Component): string | null {
  const { inner } = customHtmlOf(component)
  return inner === '' ? null : inner
}

/** New markup inside the same wrapper (or none, when the block has no settings). */
export function writeCustomHtmlMarkup(component: Component, html: string | null): void {
  const { layout } = customHtmlOf(component)
  component.components(wrap(layout, html ?? '', hideClassesOf(component)))
}

/** The wrapper written again with the block's current visibility classes, after Hide on Phones / Desktop changed. */
export function syncCustomHtmlWrapper(component: Component): void {
  const { layout, inner } = customHtmlOf(component)
  component.components(wrap(layout, inner, hideClassesOf(component)))
}
