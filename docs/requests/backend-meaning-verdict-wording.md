# Backend request: "Act" reads "Needs Action"

**For:** Insights → Benchmarks and Explain → What This Means (`docs/mockups/insights-admin-pages.html`, `docs/build-prompts/insights-admin-pages.md` A5).

**Today:** the third band is called "Act". The Benchmarks page will say **Needs Action** (frontend), but Explain's verdict chip text (`verdict.chip`, e.g. "Act") and any reasons that name the band come from the API.

**Ask:** return **Needs Action** wherever the API words that band for people (`verdict.chip`, `verdict.title`, reasons, and the PDF if it prints it). The band's key (`act`) and the stored `act` threshold stay as they are; this is wording only.

**Until then:** Benchmarks says Needs Action and Explain says Act. Nothing breaks.
