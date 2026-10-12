/**
 * Captures the decided screens from mockups/flow-parts-2026-10.html as cell
 * data, so the shell's tests can hold it to them cell for cell:
 *
 * - tests/shell/fixtures/home-mockup.json — the four "Home ✓" states.
 * - tests/shell/fixtures/commands-mockup.json — the four steps of N6, the
 *   commands as a fourth tab of home ("Commands ✓", 04a).
 * - tests/shell/fixtures/bar-mockup.json — the header bar (04), one row per
 *   mode and question.
 *
 * The mockup draws every frame as ANSI written into xterm.js. This runs the
 * page's own script under a stub DOM, catches the rows it draws, and parses
 * each into a grid of cells, stored per row as runs of one style. Run it
 * again whenever the mockup changes:
 *
 *   node scripts/home-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

const HOOK = 'const rows = homeScreen(FINAL, s)'
const RENDER = '/* ------------------------------------------------------------- render */'
/** The bar at every question of convert, and at the second of compress and pdf, as the mockup shows it. */
const BARS = [
  ['convert', 0],
  ['convert', 1],
  ['convert', 2],
  ['convert', 3],
  ['compress', 1],
  ['pdf', 1],
]
let script = mockupScript('flow-parts-2026-10.html')
// Catch the decided screen at the one call that draws it, rather than by
// the order frames happen to be written in: the page grows other sections.
if (!script.includes(HOOK)) throw new Error(`mockup no longer contains "${HOOK}"`)
script = script.replace(HOOK, `${HOOK}; globalThis.__home.push({ label: s.label, rows })`)
// Tab 4's frames are built by functions in scope just before the page
// starts drawing, so they are called there, before any DOM work can fail.
script = inject(
  script,
  RENDER,
  `globalThis.__n6 = N6SEQ.map((st) => ({ label: st.label, rows: st.rows() }))
globalThis.__bar = ${JSON.stringify(BARS)}.map(([m, at]) => ({ mode: m, at, rows: [trailBarRight({ convert: CV_, compress: CM_, pdf: PDF_ }[m], at)] }))`,
)
globalThis.__home = []
runMockup(script)

const STATES = [
  { label: 'empty', mode: 'convert', text: '' },
  { label: 'typing ~/Desk', mode: 'convert', text: '~/Desk' },
  { label: 'pressed 2', mode: 'compress', text: '' },
  { label: 'pressed 3, typing', mode: 'pdf', text: '~/Desk' },
]
if (globalThis.__home.length !== STATES.length) throw new Error('expected the four Home ✓ states')
const frames = STATES.map((state, i) => {
  const { label, rows } = globalThis.__home[i]
  if (label !== state.label) throw new Error(`state ${i} is "${label}", expected "${state.label}"`)
  return { ...state, rows: fixtureRows(rows, 80, 24) }
})
writeFileSync(
  `${root}tests/shell/fixtures/home-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)

const N6 = [
  { label: '1 · home', mode: 'convert', text: '' },
  { label: '2 · typed /', mode: 'convert', text: '/', selected: 'convert' },
  { label: '3 · typed /co, then ↓', mode: 'convert', text: '/co', selected: 'compress' },
  { label: '4 · pressed ↵', mode: 'compress', text: '' },
]
if (globalThis.__n6?.length !== N6.length) throw new Error('expected the four N6 steps')
const commands = N6.map((step, i) => {
  const { label, rows } = globalThis.__n6[i]
  if (label !== step.label) throw new Error(`step ${i} is "${label}", expected "${step.label}"`)
  return { ...step, rows: fixtureRows(rows, 80, 24) }
})
writeFileSync(
  `${root}tests/shell/fixtures/commands-mockup.json`,
  `${JSON.stringify(commands, null, 1)}\n`,
)

const bars = globalThis.__bar.map(({ mode, at, rows }) => ({
  label: `${mode} at ${at}`,
  mode,
  at,
  rows: fixtureRows(rows, 80, 1),
}))
writeFileSync(`${root}tests/shell/fixtures/bar-mockup.json`, `${JSON.stringify(bars, null, 1)}\n`)
console.log(
  `wrote ${frames.length} home frames, ${commands.length} commands steps, ${bars.length} bars`,
)
