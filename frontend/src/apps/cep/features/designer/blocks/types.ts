export interface CepBlock {
  id: string
  label: string
  category: 'structure' | 'content' | 'brand' | 'commerce'
  /** a lucide icon name, not a component: this file stays free of React */
  icon: string
  mjml: string
}
