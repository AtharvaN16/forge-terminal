import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { TERM_CSS } from './term-cells.js'
const grids = JSON.parse(readFileSync('/tmp/colour-audit/redesign-grids.json', 'utf8')) as Record<string, string>
const C = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for (const [id, html] of Object.entries(grids)) {
  const page = `<!doctype html><meta charset=utf-8><style>${TERM_CSS} html,body{margin:0;background:#f0f} body{padding:3px} .t{border:none;border-radius:0}</style>${html}`
  writeFileSync(`/tmp/colour-audit/rd-${id}.html`, page)
  const raw = `/tmp/colour-audit/rd-${id}.raw.png`
  execFileSync(C, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=760,520', `--screenshot=${raw}`, `file:///tmp/colour-audit/rd-${id}.html`], { stdio: 'ignore' })
  const buf = await sharp(raw).trim({ background: '#ff00ff', threshold: 10 }).png().toBuffer()
  const i = await sharp(buf).resize({ width: 1000 }).webp({ quality: 88 }).toFile(`mockups/colour-redesign-2026-10/${id}.webp`)
  console.log(id, i.size)
}
