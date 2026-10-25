import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const d = JSON.parse(readFileSync('/tmp/colour-audit/grids.json', 'utf8'))
const C = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for (const [id] of d.keys as [string, string][]) {
  const html = `<!doctype html><meta charset=utf-8><style>${d.css} html,body{margin:0;background:#f0f} body{padding:3px} .t{border:none;border-radius:0}</style><div class="t" style="background:#1e1e1e">${d.grids[id]}</div>`
  writeFileSync(`/tmp/colour-audit/shots/${id}.html`, html)
  const raw = `/tmp/colour-audit/shots/${id}.raw.png`
  execFileSync(
    C,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=760,520',
      `--screenshot=${raw}`,
      `file:///tmp/colour-audit/shots/${id}.html`,
    ],
    { stdio: 'ignore' },
  )
  const info = await sharp(raw)
    .trim({ background: '#ff00ff', threshold: 10 })
    .png()
    .toFile(`/tmp/colour-audit/shots/${id}.png`)
  console.log(id, info.width, info.height)
}
