/**
 * Captures the decided error frames from mockups/flow-parts-2-2026-10.html,
 * tab "9 · Errors ✓", as cell data:
 *
 * - tests/shell/fixtures/errors-mockup.json — E5 (a tab on a tinted panel,
 *   for a run that failed) for "Cannot write there" and "Cannot get that
 *   small", and E5·b (one tinted row) for a path that is not there, a damaged
 *   file dropped and a size it cannot read. Each is the whole 80×24 frame:
 *   home back under the panel, or the size step above the row.
 *
 * Run it again whenever the mockup changes:
 *
 *   node scripts/errors-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

const RENDER = "fig('errors-grid', { id: ER5.id"
const script = inject(
  mockupScript('flow-parts-2-2026-10.html'),
  RENDER,
  "globalThis.__errors = { write: e5(ER.write).rows, small: e5(ER.small).rows, lines: K1.map((k) => line1Screen(ER1[k], 'b').rows) }",
)
runMockup(script)
if (!globalThis.__errors) throw new Error('the mockup did not draw the errors')

const { write, small, lines } = globalThis.__errors
const frames = [
  { label: 'E5 · write', kind: 'panel', rows: fixtureRows(write, 80, 24) },
  { label: 'E5 · small', kind: 'panel', rows: fixtureRows(small, 80, 24) },
  ...['missing', 'damaged', 'size'].map((key, i) => ({
    label: `E5·b · ${key}`,
    kind: 'line',
    rows: fixtureRows(lines[i], 80, 24),
  })),
]
writeFileSync(
  `${root}tests/shell/fixtures/errors-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)
console.log(`wrote ${frames.length} error frames`)
