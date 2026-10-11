/**
 * Captures the decided home screen from mockups/flow-parts-2026-10.html as
 * cell data, so tests/shell/home-screen.test.tsx can hold the shell to it
 * cell for cell.
 *
 * The mockup draws every frame as ANSI written into xterm.js. This runs the
 * page's own script under a stub DOM, catches the rows it draws for the four
 * "Home ✓" states, and parses each into an 80×24 grid of
 * cells, stored per row as runs of one style. Run it again whenever the mockup changes:
 *
 *   node scripts/home-mockup-fixture.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const html = readFileSync(`${root}mockups/flow-parts-2026-10.html`, 'utf8')
const HOOK = 'const rows = homeScreen(FINAL, s)'
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join('\n')
  // Catch the decided screen at the one call that draws it, rather than by
  // the order frames happen to be written in: the page grows other sections.
  .replace(HOOK, `${HOOK}; globalThis.__home.push({ label: s.label, rows })`)
if (!script.includes('globalThis.__home')) throw new Error(`mockup no longer contains "${HOOK}"`)
globalThis.__home = []

const el = () => {
  const e = {
    innerHTML: '',
    className: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    querySelector: () => el(),
  }
  e.querySelectorAll = () => [el(), el(), el(), el()]
  return e
}
globalThis.document = {
  getElementById: () => el(),
  createElement: () => el(),
  querySelector: () => el(),
  querySelectorAll: () => [],
  addEventListener() {},
}
globalThis.location = { hash: '#home' }
globalThis.window = globalThis
globalThis.Terminal = class {
  constructor(o) {
    this.o = o
  }
  open() {}
  loadAddon() {}
  write() {}
}
globalThis.CanvasAddon = { CanvasAddon: class {} }
// Later sections of the page need a real DOM; the frames wanted are drawn first.
try {
  new Function(script)()
} catch {}

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
  const token = new RegExp(`${ESC}\\[([0-9;]*)([mH])|\\r\\n|([^${ESC}])`, 'gu')
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
    } else if (m[2] === 'H') {
      // the cursor position: not a cell
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
  return { ...state, rows: cells(rows.slice(0, 24).join('\r\n'), 80, 24).map(runs) }
})
writeFileSync(
  `${root}tests/shell/fixtures/home-mockup.json`,
  `${JSON.stringify(frames, null, 1)}\n`,
)
console.log(`wrote ${frames.length} frames`)
