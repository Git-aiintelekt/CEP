/** The receipt editor's own words for its two versioned parts, shared by the workspace and its tests. */
export const DESIGN_NAME = 'Outer design'
export const LAYOUT_NAME = 'Receipt layout'

export const conflictNote = (name: string) => `The ${name.toLowerCase()} was changed elsewhere. Load its latest version to continue.`
export const olderNote = (name: string, version: number) =>
  `You are looking at ${name.toLowerCase()} version ${version}. Saving from here creates a new version on top of the latest.`
