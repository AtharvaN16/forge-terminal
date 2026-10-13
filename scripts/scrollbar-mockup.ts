/**
 * The commands list's scroll bar (2026-10-13): three ways to show that the
 * list has more rows than the panel. At 80 × 24 /update sits one row below
 * the panel, and nothing said so.
 *
 * The rows are the app's own `commandRows` at the real 80 × 24 home layout;
 * only the bar (and S2's note) is added here.
 *
 *   npx tsx scripts/scrollbar-mockup.ts   → mockups/commands-scroll-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import { listCommands } from '../src/shell/commands.js'
import { homeLayout } from '../src/shell/components/Home.js'
import { commandRows, HOME_MARGIN, type Row, type Run } from '../src/shell/home-art.js'
import { DARK, LIGHT, type Palette } from '../src/shell/theme.js'

const N = 80
const H = 24

interface Cell {
  ch: string
  fg?: string
  bg?: string
  b?: boolean
}
const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r: Run) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg, b: r.bold })))

type Variant = 'none' | 'S1' | 'S2' | 'S3'

function screen(palette: Palette, variant: Variant, selected: number): Cell[][] {
  const layout = homeLayout(N, H)
  const list = listCommands('')
  const rows = commandRows({
    width: N,
    palette,
    ...list,
    selected,
    rows: layout.surface,
    max: layout.surface + layout.list - 1,
  }).map(cellsOf)

  // The same count commandRows uses: every line it would draw, before it
  // keeps `room` of them.
  const groups = (['modes', 'settings'] as const).filter((g) =>
    list.items.some((c) => c.group === g),
  )
  const total = list.items.length + groups.length + (groups.length - 1)
  const room = rows.length - 2
  const hidden = total - room

  if (variant !== 'none' && hidden > 0) {
    // Where the shown window starts: recovered from the rows, by finding the
    // first visible command (cheap, and it is a mockup).
    const firstText = rows[1]?.map((c) => c.ch).join('') ?? ''
    const start = firstText.includes('modes') ? 0 : hidden
    const thumb = Math.max(1, Math.round((room * room) / total))
    const at = Math.round((start / Math.max(1, total - room)) * (room - thumb))
    const col = N - HOME_MARGIN - 1
    const [track, knob] = variant === 'S3' ? ['░', '█'] : ['│', '┃']
    for (let i = 0; i < room; i++) {
      const cell = rows[1 + i]?.[col]
      if (!cell) continue
      const on = i >= at && i < at + thumb
      cell.ch = on ? knob : track
      cell.fg = on ? palette.dim : palette.faint
    }
    if (variant === 'S2') {
      const below = total - (start + room)
      const note = below > 0 ? `↓ ${below} more` : `↑ ${start} more`
      const last = rows[rows.length - 1] as Cell[]
      ;[...note].forEach((ch, k) => {
        const cell = last[col - 1 - note.length + 1 + k]
        if (cell) Object.assign(cell, { ch, fg: palette.dim })
      })
    }
  }
  return rows
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function html(rows: Cell[][], palette: Palette): string {
  return rows
    .map((cells) => {
      let out = ''
      for (const c of cells) {
        const st = [
          `color:${c.fg || palette.fg}`,
          c.bg ? `background:${c.bg}` : '',
          c.b ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        out += `<span style="${st}">${esc(c.ch)}</span>`
      }
      return `<div class="r">${out}</div>`
    })
    .join('')
}

const VARIANTS: { id: Variant; name: string; idea: string; pick?: boolean }[] = [
  { id: 'none', name: 'Today', idea: 'No sign that /update is one row below the panel.' },
  {
    id: 'S1',
    name: 'Thin line',
    idea: 'A faint thin track │ with a grey thick thumb ┃ on the panel’s right edge. Only when the list overflows. No new colour.',
    pick: true,
  },
  {
    id: 'S2',
    name: 'Line + “more” note',
    idea: 'S1’s bar, plus a dim “↓ 1 more” on the panel’s bottom edge: says how much is hidden, not only that something is.',
  },
  {
    id: 'S3',
    name: 'Solid block',
    idea: 'A dotted track ░ with a solid thumb █. Easier to spot; louder on the quiet panel.',
  },
]

const lastIndex = listCommands('').items.length - 1
const figures = VARIANTS.map((v) => {
  const pair = (selected: number, label: string) =>
    [DARK, LIGHT]
      .map(
        (p) =>
          `<div class="t" style="background:${p === LIGHT ? '#ffffff' : '#1e1e1e'}">${html(screen(p, v.id, selected), p)}</div>`,
      )
      .join('') + `<div class="cap">${label}</div>`
  return `<figure><div class="vt"><span class="id">${v.id === 'none' ? '—' : v.id}</span><span class="name">${v.name}</span>${v.pick ? '<span class="pick">RECOMMENDED</span>' : ''}</div>
<p class="idea">${esc(v.idea)}</p>
<div class="theme">${pair(0, 'top of the list (/convert chosen)')}</div>
<div class="theme">${pair(lastIndex, 'scrolled to the end (/update chosen)')}</div></figure>`
}).join('\n')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Commands scroll bar</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1900px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; } .lede { color:#8f94a1; max-width:1000px; margin:0; }
  figure { margin:40px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:6px 0 12px; max-width:1000px; }
  .theme { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end; margin-top:12px; }
  .cap { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; }
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; } .r > span { display:inline-block; height:17px; line-height:17px; }
</style></head><body><main>
<h1>Commands: a scroll bar</h1>
<p class="lede">The commands panel at 80 × 24, drawn by the app’s own <code>commandRows</code>, dark and light. The list has one row more than fits — /update — so the thumb is nearly the panel’s height. Each style is shown at the top of the list and scrolled to the end.</p>
${figures}
</main></body></html>`

writeFileSync('mockups/commands-scroll-2026-10.html', page)
console.log('wrote mockups/commands-scroll-2026-10.html')
