/**
 * Captures the decided drop zone from mockups/drop-zone-2026-10.html (round
 * three) as cell data, so the shell's tests can hold it to it cell for cell:
 *
 * - tests/shell/fixtures/drop-mockup.json — one file (the card), three
 *   photos (the list), and eight files with one left out (the list and the
 *   red line under the field). Settled frames: no fresh band.
 *
 * The mockup's greys are swapped for the app's neutral ones on the way in
 * (see `mockupScript`). Run it again whenever the mockup changes:
 *
 *   node scripts/drop-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

const HOOK = "fig('drop3-grid', {"
const STATES = [
  { label: 'one', mode: 'convert', key: 'one' },
  { label: 'three', mode: 'convert', key: 'three' },
  { label: 'many, one left out', mode: 'convert', key: 'many' },
]
const script = inject(
  mockupScript('drop-zone-2026-10.html'),
  HOOK,
  `globalThis.__drop = ${JSON.stringify(STATES.map((s) => s.key))}.map((k) => dropScreen3(CV_, S2[k], 9, 'line').rows)`,
)
runMockup(script)
if (!globalThis.__drop) throw new Error('the mockup did not draw the drop zone')

const frames = STATES.map(({ label, mode }, i) => ({
  label,
  mode,
  text: '',
  rows: fixtureRows(globalThis.__drop[i], 80, 24),
}))
writeFileSync(
  `${root}tests/shell/fixtures/drop-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)
console.log(`wrote ${frames.length} drop frames`)
