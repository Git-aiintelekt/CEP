// Builds the stakeholder briefings in docs/ as Word documents from the Markdown of the same name, with the manuals' builder:
//   node docs/tools/build_briefings.js
const fs = require('fs')
const path = require('path')
const { build } = require('./build_manuals')

const DOCS = path.resolve(__dirname, '..')
const BRIEFINGS = [
  { file: 'CEP_Technical_Stack_and_Capabilities', title: 'CEP: Technical Stack and Capabilities', subtitle: 'A briefing for stakeholders' },
  { file: 'CEP_Demo_Script', title: 'CEP Demo Script for Stakeholders', subtitle: 'A 60-minute walk through the product, with a 20-minute cut' },
]

Promise.all(BRIEFINGS.map((item) => build({
  title: item.title, subtitle: item.subtitle, out: item.file, outDir: DOCS, markdown: false, source: `docs/${item.file}.md`,
  chapters: [{ name: item.file, source: fs.readFileSync(path.join(DOCS, `${item.file}.md`), 'utf8') }],
}))).catch((error) => { console.error(error); process.exit(1) })
