import type { ReactNode } from 'react'

import { EditorScopeContext } from './editorScope'

/** The template editors keep 4px corners and their own type sizes (.editor-radii, .editor-type); `contents` adds no box. */
export function EditorScope({ children }: { children: ReactNode }) {
  return <EditorScopeContext.Provider value><div className="editor-radii editor-type contents">{children}</div></EditorScopeContext.Provider>
}
