import { createContext, useContext } from 'react'

/** True inside a template editor, so dialogs it portals to <body> keep the editors' type sizes (.editor-type). */
export const EditorScopeContext = createContext(false)

export const useEditorTypeClass = () => (useContext(EditorScopeContext) ? 'editor-type' : '')
