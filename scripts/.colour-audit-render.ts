import { readFileSync, writeFileSync } from 'node:fs'
import { gridHtml, TERM_CSS } from '../scripts/term-cells.js'
import { DARK } from '../src/shell/theme.js'
const frames = JSON.parse(readFileSync('/tmp/colour-audit/frames.json', 'utf8'))
const out: Record<string, string> = {}
for (const f of frames) {
  const rows = f.rows.map((r: any[]) => r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })))
  out[f.id] = gridHtml(rows, DARK)
}
writeFileSync('/tmp/colour-audit/grids.json', JSON.stringify({ css: TERM_CSS, keys: frames.map((f: any) => [f.id, f.keys]), grids: out }))
const page = `<!doctype html><meta charset=utf-8><style>${TERM_CSS} body{background:#111;color:#ddd;font-family:system-ui} .f{display:inline-block;margin:10px;vertical-align:top} h3{font-size:13px}</style>` +
  frames.map((f: any) => `<div class=f><h3>${f.id} — ${f.keys}</h3><div class="t" style="background:#1e1e1e">${out[f.id]}</div></div>`).join('')
writeFileSync('/tmp/colour-audit/raw.html', page)
