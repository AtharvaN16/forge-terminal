/**
 * Captures the decided Working (W5) and Quality (G1) frames from
 * mockups/flow-parts-2-2026-10.html, tabs "5 · Working ✓" and "6 · Quality ✓",
 * as cell data:
 *
 * - tests/shell/fixtures/working-mockup.json — W5, each case at a moment of
 *   its timeline, the whole 80×24 frame.
 * - tests/shell/fixtures/quality-mockup.json — G1's slider at several
 *   values, with the row under it and the title above.
 *
 * Both are live in the mockup, so each frame is taken at a fixed time.
 * Run it again whenever the mockup changes:
 *
 *   node scripts/flow2-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

/** Each case at a moment: before the clock, after it, mid-search, mid-split. */
const WORK = [
  ['convert', 0.5],
  ['convert', 4.0],
  ['compress', 1.3],
  ['pdf', 1.0],
  ['pdf', 3.9],
]
const VALUES = [80, 75, 60, 35, 5, 1, 100]

const RENDER = 'for (const v of [...QUAL4, ...QUAL, ...QUAL2, ...QUAL3]) {'
const script = inject(
  mockupScript('flow-parts-2-2026-10.html'),
  RENDER,
  `globalThis.__w5 = ${JSON.stringify(WORK)}.map(([k, t]) => ({ k, t, rows: W5(k)(t) }))
globalThis.__g1 = ${JSON.stringify(VALUES)}.map((q) => ({ q, rows: [qTitle(CV_, 'Quality', 'JPEG'), QUAL4[0].body(QJOBS.convert, q, false, 0)[0], ends(SW)] }))`,
)
runMockup(script)
if (!globalThis.__w5 || !globalThis.__g1) throw new Error('the mockup did not draw W5 and G1')

const working = globalThis.__w5.map(({ k, t, rows }) => ({
  label: `${k} at ${t}s`,
  mode: { convert: 'convert', compress: 'compress', pdf: 'pdf' }[k],
  t,
  rows: fixtureRows(rows, 80, 24),
}))
writeFileSync(
  `${root}tests/shell/fixtures/working-mockup.json`,
  `${JSON.stringify(working, null, 1)}\n`,
)

const quality = globalThis.__g1.map(({ q, rows }) => ({
  label: `quality ${q}`,
  mode: 'convert',
  q,
  rows: fixtureRows(rows, 80),
}))
writeFileSync(
  `${root}tests/shell/fixtures/quality-mockup.json`,
  `${JSON.stringify(quality, null, 1)}\n`,
)
console.log(`wrote ${working.length} working frames, ${quality.length} quality sliders`)
