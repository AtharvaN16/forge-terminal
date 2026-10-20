/**
 * The supported-formats panel with more air (2026-10-20): today's panel, then
 * A without the rule and B without the title. Drawn with one span per run of
 * a style, exactly n ch wide, so the fill has no seams; the rule is a drawn
 * line, not a glyph.
 *
 *   npx tsx scripts/formats-spacing-mockup.ts   → mockups/formats-spacing-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80
const M = 2
const W = N - M * 2
const X = 3
const H = 8
const KINDS: [string, string][] = [
  ['Images', 'JPEG · PNG · WebP · AVIF · GIF'],
  ['Video', 'MP4 · MOV · WebM · MKV · AVI'],
  ['Audio', 'MP3 · M4A · Opus · FLAC · AIFF · WAV · OGG'],
  ['PDF', 'PDF'],
]
const LEAD = Math.max(...KINDS.map(([k]) => k.length)) + 3

interface Seg {
  n: number
  text?: string
  fg?: string
  bg?: string
  bold?: boolean
  rule?: boolean
}
type Line = Seg[]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function panel(p: Palette, v: 'now' | 'a' | 'b'): Line[] {
  const fill = p.selectionBg
  const row = (segs: Seg[]): Line => {
    const used = segs.reduce((a, s) => a + s.n, 0)
    return [{ n: M }, ...segs.map((s) => ({ ...s, bg: fill })), { n: W - used, bg: fill }]
  }
  const blank = () => row([])
  const title = () =>
    row([
      { n: X },
      { n: 17, text: 'Supported formats', fg: modeColours(p, 'convert').fg, bold: true },
    ])
  const rule = () => row([{ n: X }, { n: W - X * 2, rule: true, fg: p.border }])
  const entry = ([kind, formats]: [string, string]) =>
    row([
      { n: X },
      { n: LEAD, text: kind, fg: p.fg, bold: true },
      { n: formats.length, text: formats, fg: p.dim },
    ])
  const entries = KINDS.map(entry)
  if (v === 'now') return [blank(), title(), rule(), ...entries, blank()]
  if (v === 'a') return [blank(), title(), blank(), ...entries, blank()]
  return [blank(), blank(), ...entries, blank(), blank()]
}

function draw(lines: Line[], p: Palette, canvas: string): string {
  const spans = (l: Line) =>
    l
      .filter((s) => s.n > 0)
      .map((s) => {
        const st = [`width:${s.n}ch`, `color:${s.fg ?? p.fg}`]
        if (s.bold) st.push('font-weight:700')
        if (s.bg) st.push(`background:${s.bg}`)
        if (s.rule)
          st.push(
            `background:linear-gradient(${s.fg},${s.fg}) center / 100% 1px no-repeat ${s.bg ?? ''}`,
          )
        return `<span style="${st.join(';')}">${s.rule ? '' : esc(s.text ?? '')}</span>`
      })
      .join('')
  const edge = `<div class="r"></div>`
  return `<div class="t" style="background:${canvas}">${edge}${lines
    .map((l) => `<div class="r">${spans(l)}</div>`)
    .join('')}${edge}</div>`
}

const VERSIONS = [
  {
    id: 'Now',
    name: 'As built',
    v: 'now' as const,
    idea: 'Title, rule, four lines, one blank row above and below. Nothing between the title and the lines but the rule.',
  },
  {
    id: 'A',
    name: 'No divider',
    v: 'a' as const,
    idea: 'The title stays; the rule goes and a blank row takes its place. Same eight rows, so nothing else on the screen moves.',
  },
  {
    id: 'B',
    name: 'No title',
    v: 'b' as const,
    idea: 'No heading; the four lines sit in the middle of the panel with two blank rows above and below. The word "Supported formats" is already on the key row’s tab hint.',
  },
]

const fig = (x: (typeof VERSIONS)[number]) => {
  const cols = [DARK, LIGHT]
    .map((base) => {
      const p = modePalette(base, 'convert')
      const canvas = p.canvas || (base === LIGHT ? '#ffffff' : '#1e1e1e')
      return `<div class="col">${draw(panel(p, x.v), p, canvas)}<div class="cap">${base === DARK ? 'dark' : 'light'}</div></div>`
    })
    .join('')
  return `<figure><div class="vt"><span class="id">${x.id}</span><span class="name">${esc(x.name)}</span></div><p class="idea">${esc(x.idea)}</p><div class="row">${cols}</div></figure>`
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Supported formats, more air</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1800px; margin:0 auto; padding:44px 24px 100px; }
  h1 { font-size:28px; margin:0 0 8px; }
  .lede { color:#8f94a1; max-width:900px; margin:0; }
  figure { margin:40px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:4px; }
  .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .name { font-weight:600; font-size:18px; }
  .idea { color:#8f94a1; margin:0 0 12px; max-width:900px; }
  .row { display:flex; gap:32px; flex-wrap:wrap; }
  .cap { color:#8f94a1; font-size:13px; margin-top:6px; }
  .t { width:80ch; padding:0; font:14px/20px "SF Mono", Menlo, "JetBrains Mono", monospace; border-radius:6px; overflow:hidden; }
  .r { display:flex; height:20px; white-space:pre; }
  .r > span { display:block; flex:none; overflow:hidden; }
</style></head><body><main>
<h1>Supported formats, with more air</h1>
<p class="lede">The panel Tab opens, at 80 columns and its usual eight rows. “Now” is the screenshot; A and B each take away one thing.</p>
${VERSIONS.map(fig).join('')}
</main></body></html>`

writeFileSync('mockups/formats-spacing-2026-10.html', page)
console.log('wrote mockups/formats-spacing-2026-10.html')
