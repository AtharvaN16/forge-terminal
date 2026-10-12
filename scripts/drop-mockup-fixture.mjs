/**
 * Captures the decided drop zone from mockups/drop-zone-2026-10.html (round
 * three) as cell data, so the shell's tests can hold it to it cell for cell:
 *
 * - tests/shell/fixtures/drop-mockup.json — one file (the card), three
 *   photos (the list), and eight files with one left out (the list and the
 *   red line under the field). Settled frames: no fresh band.
 *
 * Same method as scripts/home-mockup-fixture.mjs: run the page's own script
 * under a stub DOM, call its frame builder, parse the ANSI into cells. Run it
 * again whenever the mockup changes:
 *
 *   node scripts/drop-mockup-fixture.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const html = readFileSync(`${root}mockups/drop-zone-2026-10.html`, 'utf8')
const HOOK = "fig('drop3-grid', {"
const STATES = [
  { label: 'one', mode: 'convert', key: 'one' },
  { label: 'three', mode: 'convert', key: 'three' },
  { label: 'many, one left out', mode: 'convert', key: 'many' },
]
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join('\n')
  .replace(
    HOOK,
    `globalThis.__drop = ${JSON.stringify(STATES.map((s) => s.key))}.map((k) => dropScreen3(CV_, S2[k], 9, 'line').rows)
${HOOK}`,
  )
if (!script.includes('globalThis.__drop')) throw new Error(`mockup no longer contains "${HOOK}"`)

const el = () => {
  const e = { innerHTML: '', className: '', style: {}, appendChild() {}, closest: () => null }
  e.querySelectorAll = () => Array.from({ length: 6 }, () => el())
  return e
}
globalThis.document = { getElementById: () => el(), createElement: () => el() }
globalThis.matchMedia = () => ({ matches: false })
globalThis.Terminal = class {
  open() {}
  loadAddon() {}
  write() {}
}
globalThis.CanvasAddon = { CanvasAddon: class {} }
globalThis.setInterval = () => {}
new Function(script)()

const hex = (p) => `#${p.map((x) => x.toString(16).padStart(2, '0')).join('')}`
function cells(s, cols, rows) {
  const g = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ ch: ' ', fg: null, bg: null, b: false })),
  )
  let r = 0
  let c = 0
  let fg = null
  let bg = null
  let b = false
  const ESC = String.fromCharCode(27)
  const token = new RegExp(`${ESC}\\[([0-9;?]*)([mHlh])|\\r\\n|([^${ESC}])`, 'gu')
  for (const m of s.matchAll(token)) {
    if (m[2] === 'm') {
      const p = m[1].split(';').map(Number)
      for (let i = 0; i < p.length; i++) {
        if (p[i] === 38) {
          fg = hex(p.slice(i + 2, i + 5))
          i += 4
        } else if (p[i] === 48) {
          bg = hex(p.slice(i + 2, i + 5))
          i += 4
        } else if (p[i] === 39) fg = null
        else if (p[i] === 49) bg = null
        else if (p[i] === 1) b = true
        else if (p[i] === 22) b = false
      }
    } else if (m[2]) {
      // cursor moves and modes: not cells
    } else if (m[0] === '\r\n') {
      r++
      c = 0
    } else {
      if (r < rows && c < cols) g[r][c] = { ch: m[3], fg, bg, b }
      c++
    }
  }
  return g
}

/** A row as runs of one style: [text, fg, bg, bold]. Unstyled blanks have null colours. */
function runs(row) {
  const out = []
  for (const { ch, fg, bg, b } of row) {
    const last = out.at(-1)
    if (last && last[1] === fg && last[2] === bg && last[3] === b) last[0] += ch
    else out.push([ch, fg, bg, b])
  }
  return out
}

const frames = STATES.map(({ label, mode }, i) => ({
  label,
  mode,
  text: '',
  rows: cells(globalThis.__drop[i].slice(0, 24).join('\r\n'), 80, 24).map(runs),
}))
writeFileSync(
  `${root}tests/shell/fixtures/drop-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)
console.log(`wrote ${frames.length} drop frames`)
