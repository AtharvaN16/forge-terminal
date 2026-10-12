/**
 * Captures the decided Save as frames (P1) from
 * mockups/flow-parts-2-2026-10.html, tab "7 · Naming ✓", as cell data:
 *
 * - tests/shell/fixtures/save-as-mockup.json — `opensDown(TAGS[0])` at
 *   moments of its live script: the name being typed, the name focused, the
 *   folder list open on Desktop (the default), ↓ to Downloads, and Downloads
 *   made the default. Each is the whole 80×24 frame, with where the mockup
 *   puts the terminal's cursor.
 *
 * Run it again whenever the mockup changes:
 *
 *   node scripts/save-as-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

/** [label, time]: the moments `phase` and `opensDown` read. */
const MOMENTS = [
  ['name, test', 0.5],
  ['name, header', 3.5],
  ['folder, Desktop', 4.2],
  ['folder, Downloads', 5.5],
  ['folder, Downloads made default', 6.6],
]

const RENDER = 'for (const g of TAGS) fig('
const script = inject(
  mockupScript('flow-parts-2-2026-10.html'),
  RENDER,
  `globalThis.__p1 = ${JSON.stringify(MOMENTS)}.map(([label, t]) => ({ label, t, frame: opensDown(TAGS[0])(t) }))`,
)
runMockup(script)
if (!globalThis.__p1) throw new Error('the mockup did not draw P1')

const frames = globalThis.__p1.map(({ label, t, frame }) => ({
  label,
  mode: 'convert',
  t,
  cursor: frame.cursor,
  rows: fixtureRows(frame.rows, 80, 24),
}))
writeFileSync(
  `${root}tests/shell/fixtures/save-as-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)
console.log(`wrote ${frames.length} save as frames`)
