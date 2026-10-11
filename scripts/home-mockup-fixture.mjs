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
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const html = readFileSync(`${root}mockups/flow-parts-2026-10.html`, 'utf8')
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
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join('\n')
  // Catch the decided screen at the one call that draws it, rather than by
  // the order frames happen to be written in: the page grows other sections.
  .replace(HOOK, `${HOOK}; globalThis.__home.push({ label: s.label, rows })`)
  // Tab 4's frames are built by functions in scope just before the page
  // starts drawing, so they are called there, before any DOM work can fail.
  .replace(
    RENDER,
    `globalThis.__n6 = N6SEQ.map((st) => ({ label: st.label, rows: st.rows() }))
globalThis.__bar = ${JSON.stringify(BARS)}.map(([m, at]) => ({ mode: m, at, rows: [trailBarRight({ convert: CV_, compress: CM_, pdf: PDF_ }[m], at)] }))
${RENDER}`,
  )
if (!script.includes('globalThis.__home')) throw new Error(`mockup no longer contains "${HOOK}"`)
if (!script.includes('globalThis.__n6')) throw new Error(`mockup no longer contains "${RENDER}"`)
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
  return { ...step, rows: cells(rows.slice(0, 24).join('\r\n'), 80, 24).map(runs) }
})
writeFileSync(
  `${root}tests/shell/fixtures/commands-mockup.json`,
  `${JSON.stringify(commands, null, 1)}\n`,
)

const bars = globalThis.__bar.map(({ mode, at, rows }) => ({
  label: `${mode} at ${at}`,
  mode,
  at,
  rows: cells(rows[0], 80, 1).map(runs),
}))
writeFileSync(`${root}tests/shell/fixtures/bar-mockup.json`, `${JSON.stringify(bars, null, 1)}\n`)
console.log(
  `wrote ${frames.length} home frames, ${commands.length} commands steps, ${bars.length} bars`,
)
