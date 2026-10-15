/** mjml-browser ships no types. It reaches us through grapesjs-mjml, which is what compiles MJML in the editor. */
declare module 'mjml-browser' {
  interface MjmlError {
    line?: number
    message?: string
    formattedMessage?: string
    tagName?: string
  }
  export default function mjml2html(input: string, options?: Record<string, unknown>): { html: string; errors: MjmlError[] }
}
