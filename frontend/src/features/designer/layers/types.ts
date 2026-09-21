/** One row of the layers tree. Deliberately free of GrapesJS: the adapter builds these, the panel only draws them. */
export interface LayerNode {
  id: string
  /** the MJML component type, e.g. mj-section */
  kind: string
  name: string
  children: LayerNode[]
  open: boolean
  /** false only means hidden on the canvas; a hidden block still ships in the email */
  visible: boolean
  /** carries the hide-on-phones class: it ships and it sends, but phones are told not to draw it */
  hiddenOnPhones: boolean
  selected: boolean
  removable: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}
