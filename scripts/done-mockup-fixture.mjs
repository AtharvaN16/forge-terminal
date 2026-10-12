/**
 * Captures the decided Done frames (K3·a) from
 * mockups/flow-parts-2-2026-10.html, tab "8 · Done ✓", as cell data:
 *
 * - tests/shell/fixtures/done-mockup.json — `k3(j, { label: 'tab', arrow:
 *   'gap' })` on the page's three sample results: a PNG converted to a
 *   smaller JPEG, a JPEG compressed with a WebP offer, and a GIF converted to
 *   a larger PNG with a warning. Each is the whole 80×24 frame.
 *
 * Run it again whenever the mockup changes:
 *
 *   node scripts/done-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

const JOBS = ['cv', 'cm', 'gif']

const RENDER = "for (const d of DONE4.filter((d) => d.id === 'K3·a'))"
const script = inject(
  mockupScript('flow-parts-2-2026-10.html'),
  RENDER,
  `globalThis.__k3a = ${JSON.stringify(JOBS)}.map((k) => ({ k, j: DJ[k], rows: DONE4.find((d) => d.id === 'K3·a').make(DJ[k]).rows }))`,
)
runMockup(script)
if (!globalThis.__k3a) throw new Error('the mockup did not draw K3·a')

const frames = globalThis.__k3a.map(({ k, j, rows }) => ({
  label: j.label,
  key: k,
  mode: j.s.mode.name,
  rows: fixtureRows(rows, 80, 24),
}))
writeFileSync(
  `${root}tests/shell/fixtures/done-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)
console.log(`wrote ${frames.length} done frames`)
