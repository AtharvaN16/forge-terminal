/**
 * A key that is down, round two (2026-10-20). Decided from round one: pressed
 * and on are one look, and only the key changes — the words beside it stay as
 * they are at rest. This round varies the key's look alone, on the eight kinds
 * of key the app draws, and on the real home with Tab pressed.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/key-state-mockup-r3.tsx → mockups/key-state-2026-10-round3.html
 */
import { writeFileSync } from 'node:fs'
import { render } from 'ink-testing-library'
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { mix, type Run } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette } from '../src/shell/theme.js'
import { ansiRow } from '../tests/shell/home-cells.js'
import { feedbackPage } from './feedback-page.js'
import {
  type Cell,
  cellsOf,
  type Grid,
  gridHtml,
  run,
  solid,
  termHtml,
  toGrid,
} from './term-cells.js'

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const plain = (l: string) => l.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')

const p = modePalette(DARK, 'convert')
const mc = modeColours(p, 'convert').fg
const tint = mix(mc, p.canvas, 0.72)
const lifted = mix(p.keycapBg, p.fg, 0.3)

/* ------------------------------------------------------------ the keys */

interface Key {
  label: string
  k: string
  w: string
  /** How the key rests: a cap, bare text, a mode chip, or a bracket (no colour). */
  form: 'cap' | 'bare' | 'chip' | 'bracket'
  /** Drawn the same in every concept: the menu's gold, the no-colour form. */
  fixed?: boolean
}
const words = (w: string, fg: string): Run[] => (w ? [run(` ${w}`, fg)] : [])
const wordsAt = (key: Key): Run[] =>
  words(
    key.w,
    key.form === 'bare' || key.form === 'bracket' ? p.border : key.form === 'chip' ? mc : p.dim,
  )

const rest = (key: Key): Run[] => {
  switch (key.form) {
    case 'cap':
      return [run(` ${key.k} `, p.fg, p.keycapBg, true), ...wordsAt(key)]
    case 'bare':
      return [run(key.k, p.fg), ...wordsAt(key)]
    case 'chip':
      return [run(` ${key.k} `, p.ink, mc, true), ...wordsAt(key)]
    case 'bracket':
      return [run(`[${key.k}]`, p.border), ...wordsAt(key)]
  }
}

type Look = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/** The key while it is down — pressed or on, one look. The words stay as at rest. */
const down = (key: Key, look: Look): Run[] => {
  // "/ menu": the menu's own gold while it is open, in every concept.
  if (key.label === '/ menu') return [run(' / ', p.ink, p.brand, true), ...wordsAt(key)]
  // No colour has no fills to use: reverse video, or the dot where the concept is the dot.
  if (key.form === 'bracket')
    return look === 'F'
      ? [run('● ', p.fg, undefined, true), run(`[${key.k}]`, p.border), ...wordsAt(key)]
      : [run(`[${key.k}]`, p.canvas, p.fg, true), ...wordsAt(key)]
  if (look === 'F') return [run('● ', mc, undefined, true), ...rest(key)]
  // A chip is already filled: it goes white, in every concept but F.
  if (key.form === 'chip') return [run(` ${key.k} `, p.ink, p.fg, true), ...wordsAt(key)]
  const cap = (fg: string, bg: string): Run => run(` ${key.k} `, fg, bg, true)
  const tail = wordsAt(key)
  switch (look) {
    case 'A':
      return [cap(p.ink, mc), ...tail]
    case 'B':
      return key.form === 'bare'
        ? [run(key.k, mc, undefined, true), ...tail]
        : [cap(mc, p.keycapBg), ...tail]
    case 'C':
      return [cap(p.canvas, p.fg), ...tail]
    case 'D':
      return [cap(mc, tint), ...tail]
    case 'E':
      return [cap(p.fg, lifted), ...tail]
  }
  return rest(key)
}

/* ------------------------------------------------------------ the pictures */

const width = (r: Run[]) => r.reduce((n, x) => n + [...x.text].length, 0)
const mk = (label: string, k: string, w: string, form: Key['form'], fixed = false): Key => ({
  label,
  k,
  w,
  form,
  fixed,
})
const TAB = mk('', 'tab', 'supported formats', 'bare')
const MODES = mk('', '1–6 ←→', 'mode', 'bare')
const QUIT = mk('', 'ctrl-c', 'quit', 'bare')
const SEND = mk('', '↵', 'send', 'cap')
const CHOOSE = mk('', '↑↓', 'choose', 'cap')
const MENU = mk('/ menu', '/', 'menu', 'cap', true)
const ESC = mk('', 'esc', 'clear', 'cap')
const ENTER = mk('', 'enter', '', 'cap')
const PASTE = mk('', '⌘V', 'to paste from clipboard', 'chip')
const NONE = mk('', 'tab', 'supported formats', 'bracket', true)

const dot = (n = 1) => solid(n)
const sep = () => run(' · ', p.border)
/** A footnote line with the item at `i` drawn by `draw`. */
const foot = (draw: (k: Key) => Run[], i: number | null): Run[] =>
  [TAB, MODES, QUIT].flatMap((k, j) => [...(j ? [sep()] : []), ...(j === i ? draw(k) : rest(k))])

/** One line of a strip: a terminal row, `n` cells wide. */
const strip = (lines: Run[][], n: number) =>
  `<div class="t s" style="background:${p.canvas}">${gridHtml(
    toGrid(
      lines.map((l) => [dot(), ...l]),
      n,
    ),
    DARK,
  )}</div>`

interface Context {
  title: string
  note: string
  /** The strip at rest and while down: the same lines. */
  lines: (draw: (k: Key) => Run[]) => Run[][]
}
const CONTEXTS: Context[] = [
  {
    title: 'The bottom row, right side',
    note: 'The plain keys with no cap: tab, 1–6 ←→, ctrl-c. This is where Tab’s problem is.',
    lines: (d) => [foot(d, 0), foot(d, 1)],
  },
  {
    title: 'The bottom row, left side',
    note: 'Keys on a grey cap, as on a screen with something to confirm.',
    lines: (d) => [d(SEND), d(CHOOSE)],
  },
  {
    title: 'The row above the bottom rule',
    note: 'The “/ menu” hint, and “esc clear” while something is staged.',
    lines: (d) => [d(MENU), d(ESC)],
  },
  {
    title: 'Inside the text field',
    note: 'The enter cap while something is typed, and the paste chip.',
    lines: (d) => [d(ENTER), d(PASTE)],
  },
  {
    title: 'A terminal with no colour',
    note: 'No fills at all, so the key is bracketed.',
    lines: (d) => [d(NONE)],
  },
]

const STRIP = 62
function context(look: Look): string {
  const rows = CONTEXTS.map(
    (c) => `<div class="ctx"><b>${c.title}</b><span>${c.note}</span></div>
<div>${strip(c.lines(rest), STRIP)}</div>
<div>${strip(
      c.lines((k) => down(k, look)),
      STRIP,
    )}</div>`,
  ).join('')
  return `<style>.t.s{padding:6px 10px;border-radius:6px}.cgrid{display:grid;grid-template-columns:230px auto auto;gap:10px 14px;align-items:center;margin-top:14px}.cgrid .h{color:#8f94a1;font:600 12px -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase}.ctx b{display:block;font-size:14px}.ctx span{display:block;color:#8f94a1;font-size:12.5px;line-height:1.4}</style>
<div class="cgrid"><div></div><div class="h">Resting</div><div class="h">Down — pressed, and on</div>${rows}</div>`
}

async function homeFrame(): Promise<Grid> {
  const app = render(
    <App initialWidth={80} initialHeight={24} prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }} />,
  )
  await settle()
  app.stdin.write('\t')
  await settle()
  const lines = (app.lastFrame() ?? '').split('\n')
  app.unmount()
  const w = Math.max(...lines.map((l) => [...plain(l)].length))
  return lines.map((l) =>
    ansiRow(l, w).map(
      (c): Cell => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b }),
    ),
  )
}

/** The key row's footnote with Tab drawn as `tab`; the rest as the app draws it. */
function withFootnote(g: Grid, tab: Run[]): Grid {
  const out = g.map((r) => r.map((c) => ({ ...c })))
  const at = out.findLastIndex((r) =>
    r
      .map((c) => c.ch)
      .join('')
      .includes('ctrl-c quit'),
  )
  const row = out[at] as Cell[]
  const text = row.map((c) => c.ch).join('')
  const from = text.indexOf('tab supported')
  const to = text.trimEnd().length
  const sep = run(' · ', p.border)
  const items: Run[][] = [
    tab,
    [run('1–6 ←→', p.fg), run(' mode', p.border)],
    [run('ctrl-c', p.fg), run(' quit', p.border)],
  ]
  const draw: Run[] = items.flatMap((it, i) => (i ? [sep, ...it] : it))
  const n = width(draw)
  const blank = row[Math.max(0, from - 1)] as Cell
  for (let i = from; i < to; i++) row[i] = { ...blank, ch: ' ' }
  cellsOf(draw).forEach((c, i) => {
    row[to - n + i] = c
  })
  return out
}

/* ------------------------------------------------------------------- page */

const CONCEPTS: { id: Look; name: string; idea: string }[] = [
  {
    id: 'A',
    name: 'The key on a chip in the mode’s colour',
    idea: 'Down, the key is filled with the mode’s colour, as a hint in the field is and as “/ menu” is when open. The loudest.',
  },
  {
    id: 'B',
    name: 'The key in the mode’s colour, no fill',
    idea: 'Down, only the key’s own letters change colour. A cap keeps its grey, a footnote key stays bare, so nothing shifts or grows. The quietest.',
  },
  {
    id: 'C',
    name: 'The key inverted, white',
    idea: 'Down, the cap is white with a dark key: the pressed look the key row has today, kept for as long as the key is on. The brightest, and in no colour at all.',
  },
  {
    id: 'D',
    name: 'The key on a tinted cap',
    idea: 'Down, the cap is tinted with the mode’s colour and the key is in that colour. Between A and B.',
  },
  {
    id: 'E',
    name: 'A lifted grey cap',
    idea: 'Down, the cap steps up a few shades of grey and the key is white. No colour, no white block: it only looks nearer. The most neutral.',
  },
  {
    id: 'F',
    name: 'A dot in front of the key',
    idea: 'Down, a dot in the mode’s colour comes before the key, which is otherwise as at rest. The one that still says “on” with no colour at all.',
  },
]

const home = await homeFrame()
const block = (look: Look) =>
  `<div class="stack">${termHtml(DARK, withFootnote(home, down(TAB, look)))}${context(look)}</div>`

writeFileSync(
  'mockups/key-state-2026-10-round3.html',
  feedbackPage({
    page: 'key-state-round3',
    title: 'Forge · A key that is down, round three',
    heading: 'A key that is down',
    lede: 'Same question as before, drawn so each place a key lives is named. Settled: pressed and on look the same, and only the key changes — the words beside it stay as they are. Each concept below shows the home screen with Tab pressed (its key is the plain one on the bottom row), then every place the app puts a key — resting on the left, down on the right. Open: which look for the key? Dark only.',
    compact: true,
    concepts: CONCEPTS.map((c) => ({ id: c.id, name: c.name, idea: c.idea, html: block(c.id) })),
  }),
)
console.log('wrote mockups/key-state-2026-10-round3.html')
process.exit(0)
