/**
 * What the mockup fixture scripts share: running a mockup page's own script
 * under a stub DOM, and reading the ANSI it draws as cells.
 *
 * A mockup draws every frame as ANSI written into xterm.js. The scripts call
 * the page's frame builders from a hook injected into its script, then parse
 * each frame into a grid of cells, stored per row as runs of one style.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('..', import.meta.url))

/** The page's inline scripts, joined, read from `mockups/<name>`. */
/**
 * The app's greys went neutral after these mockups were drawn (colour spec
 * §2.5, theme.ts DARK). Each old blue-tinted grey in a mockup's script is
 * swapped for its neutral value before the script runs, so every colour
 * derived from one (the drop zone's dots are mixes of the panel colour) is
 * recomputed rather than patched afterwards. The mockup files are untouched.
 * Text greys were raised for contrast; fills keep their OKLab lightness.
 */
const NEUTRAL = {
  '#e4e8f0': '#e7e7e7', // fg, pill, thumb
  '#8b93a6': '#b0b0b0', // dim
  '#5f6879': '#808080', // border, quiet text
  '#3d4350': '#4d4d4d', // faint
  '#252c3a': '#2c2c2c', // selectionBg, band: drop zone, field, home panel
  '#2b3343': '#333333', // panel2
  '#2e3340': '#333333', // keycapBg
  '#2a3242': '#323232', // listBand
  '#33405a': '#404040', // panelBand
  '#2a2e37': '#2e2e2e', // track
  '#4b515d': '#515151', // trackFill
  '#3b414d': '#414141', // folderChip
  '#383d48': '#3d3d3d', // fieldBand
}
const neutral = (s) => s.replace(/#[0-9a-fA-F]{6}\b/g, (h) => NEUTRAL[h.toLowerCase()] ?? h)

export function mockupScript(name) {
  const html = readFileSync(`${root}mockups/${name}`, 'utf8')
  return neutral([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'))
}

/** `script` with `code` run just before the first `marker`, which must be there. */
export function inject(script, marker, code) {
  if (!script.includes(marker)) throw new Error(`mockup no longer contains "${marker}"`)
  return script.replace(marker, `${code}\n${marker}`)
}

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
    closest: () => null,
  }
  e.querySelectorAll = () => [el(), el(), el(), el()]
  return e
}

/** Runs a page's script under a stub DOM. Sections that need a real one fail quietly, after the hooks. */
export function runMockup(script) {
  globalThis.document = {
    getElementById: () => el(),
    createElement: () => el(),
    querySelector: () => el(),
    querySelectorAll: () => [],
    addEventListener() {},
  }
  globalThis.location = { hash: '#home' }
  globalThis.window = globalThis
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.Terminal = class {
    constructor(o) {
      this.o = o
    }
    open() {}
    loadAddon() {}
    write() {}
  }
  globalThis.CanvasAddon = { CanvasAddon: class {} }
  // Live frames redraw on a timer; nothing here should keep the process alive.
  const timer = globalThis.setInterval
  globalThis.setInterval = () => 0
  try {
    new Function(script)()
  } catch {
  } finally {
    globalThis.setInterval = timer
  }
}

const hex = (p) => `#${p.map((x) => x.toString(16).padStart(2, '0')).join('')}`
const ESC = String.fromCharCode(27)

/** ANSI rows joined by \r\n, as a grid of cells. Cursor moves and mode switches are not cells. */
export function cells(s, cols, rows) {
  const g = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ ch: ' ', fg: null, bg: null, b: false })),
  )
  let r = 0
  let c = 0
  let fg = null
  let bg = null
  let b = false
  const token = new RegExp(
    `${ESC}\\[\\?[0-9]*[hl]|${ESC}\\[([0-9;]*)([mH])|\\r\\n|([^${ESC}])`,
    'gu',
  )
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
    } else if (m[2] === 'H' || m[0].startsWith(`${ESC}[?`)) {
      // the cursor position, or showing and hiding it: not a cell
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
export function runs(row) {
  const out = []
  for (const { ch, fg, bg, b } of row) {
    const last = out.at(-1)
    if (last && last[1] === fg && last[2] === bg && last[3] === b) last[0] += ch
    else out.push([ch, fg, bg, b])
  }
  return out
}

/** ANSI rows as fixture rows: `count` rows of `cols` cells, each as runs. */
export function fixtureRows(rows, cols = 80, count = rows.length) {
  return cells(rows.slice(0, count).join('\r\n'), cols, count).map(runs)
}
