---
name: cep-design
description: Use this skill to generate well-branded interfaces and assets for CEP, either for production code or throwaway prototypes and mocks. Contains the CEP design token layer (colour, type, spacing, shape, motion), visual and voice guidelines, and specimen cards.
user-invocable: true
---

Read `README.md` in this skill first — it is the complete, self-sufficient reference (token tables, interaction rules, content rules, substitutions). `DESIGN-SYSTEM.md` has the longer-form authored guidance behind those rules.

The token layer is plain CSS custom properties: `styles.css` `@import`s the seven files in `tokens/`. Adopt it directly by copying `styles.css` + `tokens/` into the project and linking `styles.css` once at the root, or port the values into whatever theming the codebase already uses — keeping the primitive → semantic split, with components referencing only semantic token names.

`guidelines/*.html` are specimen cards: documentation of what each token group looks like. Read and open them for reference; never ship them.

When building visual artifacts (mocks, prototypes, slides), write static HTML that links `styles.css`. When working in production code, follow the codebase's existing framework and patterns and compose the tokens — do not paste the specimen HTML in.

If invoked with no other guidance, ask what the user wants to build, ask a few clarifying questions, and act as an expert CEP designer.
