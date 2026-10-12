/**
 * Captures colour mode as decided, from mockups/colour-2026-10.html, tab
 * "★ Flow", as cell data:
 *
 * - tests/shell/fixtures/colour-mockup.json — `frames`: every step of the
 *   flow (1–12) and of the branch from home (B1–B3), each the whole 80×24
 *   frame with where the mockup puts the cursor; and `data`: the numbers the
 *   mockup drew from (the Sonoma palette, its shades, the scales), so the
 *   tests can build the same screens from the same inputs.
 *
 * The flow draws the field as the decided filled neutral block only while
 * `USE_FILLED` is set, so it is set around the capture.
 *
 *   node scripts/colour-mockup-fixture.mjs
 */
import { writeFileSync } from 'node:fs'
import { fixtureRows, inject, mockupScript, root, runMockup } from './mockup-cells.mjs'

const TABS = '/* ------------------------------------------------------------------ tabs */'
const script = inject(
  mockupScript('colour-2026-10.html'),
  TABS,
  `USE_FILLED = true
globalThis.__colour = {
  data: CDATA,
  frames: [...STEPS, ...BRANCH].map((st) => {
    const out = st.r()
    return { id: st.id, title: st.title, rows: out.rows ?? out, cursor: out.cursor ?? null }
  }),
}
USE_FILLED = false`,
)
runMockup(script)
if (!globalThis.__colour) throw new Error('the mockup did not draw the flow')

const { data, frames } = globalThis.__colour
const out = {
  data,
  frames: frames.map(({ id, title, rows, cursor }) => ({
    id,
    label: `${id} · ${title}`,
    mode: 'colour',
    text: '',
    cursor,
    rows: fixtureRows(rows, 80, 24),
  })),
}
writeFileSync(`${root}tests/shell/fixtures/colour-mockup.json`, `${JSON.stringify(out, null, 1)}\n`)
console.log(`wrote ${out.frames.length} colour frames`)
