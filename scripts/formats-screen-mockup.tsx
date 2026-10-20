/**
 * The supported formats with more air, on the whole home screen (2026-10-20).
 * The real App is rendered with Tab pressed; A and B only rearrange the rows
 * of its drop surface, so every other row is the app's own.
 *
 *   FORGE_NO_FIND=1 npx tsx scripts/formats-screen-mockup.tsx → mockups/formats-spacing-2026-10-screens.html
 */
import { writeFileSync } from 'node:fs'
import { render } from 'ink-testing-library'
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { DARK, LIGHT } from '../src/shell/theme.js'
import { ansiRow } from '../tests/shell/home-cells.js'
import { type Cell, type Grid, TERM_CSS, termHtml } from './term-cells.js'

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const plain = (l: string) => l.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')

async function frame(theme: 'dark' | 'light'): Promise<Grid> {
  const app = render(
    <App initialWidth={80} initialHeight={24} prefs={{ ...DEFAULT_PREFERENCES, theme }} />,
  )
  await settle()
  app.stdin.write('\t')
  await settle()
  const lines = (app.lastFrame() ?? '').split('\n')
  app.unmount()
  const width = Math.max(...lines.map((l) => [...plain(l)].length))
  return lines.map((l) =>
    ansiRow(l, width).map(
      (c): Cell => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b }),
    ),
  )
}

type Variant = 'now' | 'a' | 'b'
function variant(g: Grid, v: Variant): Grid {
  const title = g.findIndex((r) =>
    r
      .map((c) => c.ch)
      .join('')
      .includes('Supported formats'),
  )
  const top = title - 1
  const field = g.findIndex(
    (r, i) =>
      i > title &&
      r
        .map((c) => c.ch)
        .join('')
        .includes('›'),
  )
  const end = field - 1 // the shelf's first row follows the surface
  const blank = g[top] as Cell[]
  const heading = g[title] as Cell[]
  const entries = g.slice(title + 2, end)
  const rows =
    v === 'now'
      ? g.slice(top, end)
      : v === 'a'
        ? [blank, heading, blank, ...entries]
        : [blank, ...entries, blank, blank]
  const room = end - top
  return [...g.slice(0, top), ...rows.slice(0, room), ...g.slice(end)]
}

const VERSIONS: { id: string; name: string; v: Variant; idea: string }[] = [
  {
    id: 'Now',
    name: 'As built',
    v: 'now',
    idea: 'Title, rule, four lines. Nothing between the title and the lines but the rule.',
  },
  {
    id: 'A',
    name: 'No divider',
    v: 'a',
    idea: 'The title stays; a blank row takes the rule’s place. Same rows, so nothing else moves.',
  },
  {
    id: 'B',
    name: 'No title',
    v: 'b',
    idea: 'No heading: one blank row above the four lines and two below. The key row already says “tab supported formats”.',
  },
]

const [dark, light] = [await frame('dark'), await frame('light')]
const fig = (x: (typeof VERSIONS)[number]) =>
  `<figure><div class="vt"><span class="id">${x.id}</span><span class="name">${x.name}</span></div><p class="idea">${x.idea}</p><div class="row">${[
    [DARK, dark, 'dark'] as const,
    [LIGHT, light, 'light'] as const,
  ]
    .map(
      ([base, g, label]) =>
        `<div class="col">${termHtml(base, variant(g, x.v), label === 'light' ? '#ffffff' : '#1e1e1e')}<div class="cap">${label}</div></div>`,
    )
    .join('')}</div></figure>`

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Supported formats, whole screen</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1800px; margin:0 auto; padding:44px 24px 100px; }
  h1 { font-size:28px; margin:0 0 8px; } .lede { color:#8f94a1; max-width:900px; margin:0; }
  figure { margin:40px 0 0; } .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:4px; }
  .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .name { font-weight:600; font-size:18px; } .idea { color:#8f94a1; margin:0 0 12px; max-width:900px; }
  .row { display:flex; gap:28px; flex-wrap:wrap; } .cap { color:#8f94a1; font-size:13px; margin-top:6px; }
  ${TERM_CSS}
</style></head><body><main>
<h1>Supported formats, on the whole home screen</h1>
<p class="lede">The real home at 80 × 24 with Tab pressed. Only the panel’s rows differ between the three.</p>
${VERSIONS.map(fig).join('')}
</main></body></html>`

writeFileSync('mockups/formats-spacing-2026-10-screens.html', page)
console.log('wrote mockups/formats-spacing-2026-10-screens.html')
process.exit(0)
