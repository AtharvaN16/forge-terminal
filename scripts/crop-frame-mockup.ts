/**
 * Crop to shape, round two (2026-10-13): how the preview shows where the cut
 * falls. At 80 × 24 the picture is about 15 × 13 cells; the hatch alone did
 * not say where the cut falls, and a whole purple frame (d10011a) merged with
 * purple in the photo. Decided: G, corner brackets inside the crop.
 *
 * Every picture is drawn by the app's own code (`sampleDots`, `guessCrop`,
 * `cropPictureSize`, `dotBoxOf`, `cropPictureRows`). Photos: a chess-app
 * screenshot (a purple graph line sits just above the crop) and the drawn
 * meadow scene from round one (/tmp/forge-crop/scene.png).
 *
 *   npx tsx scripts/crop-frame-mockup.ts <screenshot.png>
 *     → mockups/crop-frame-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { type Box, largestBox, sampleDots, type Thumb, zoomedBox } from '../src/core/crop.js'
import type { Size } from '../src/core/size.js'
import { guessCrop } from '../src/engines/image.js'
import { cropPictureRows, cropPictureSize, dotBoxOf } from '../src/shell/crop-art.js'
import type { Row } from '../src/shell/home-art.js'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'

interface Cell {
  ch: string
  fg: string
  bg: string
  b?: boolean
}
type Grid = Cell[][]

/* ------------------------------------------------------------- photos */

interface Photo {
  size: Size
  thumb: Thumb
}

/** As `loadCropView`: upright, at most 1024 px on the long side, raw RGB. */
async function photoOf(path: string): Promise<Photo> {
  const meta = await sharp(path).rotate().metadata()
  const { data, info } = await sharp(path)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    size: { width: meta.width ?? info.width, height: meta.height ?? info.height },
    thumb: { width: info.width, height: info.height, rgb: new Uint8Array(data) },
  }
}

interface Scene {
  name: string
  label: string
  photo: Photo
  box: Box
}

/* ------------------------------------------------------------ drawing */

const PICTURE_ROWS = 13
const WIDTH = 80

interface Look {
  name: 'dark' | 'light'
  p: Palette
  mode: string
  canvas: string
}
const lookOf = (base: Palette): Look => {
  const p = modePalette(base, 'enhance')
  return {
    name: base.name === 'light' ? 'light' : 'dark',
    p,
    mode: modeColours(p, 'enhance').fg,
    canvas: p.canvas,
  }
}

/** The dots of a scene at the app's size, and the crop in them. */
function laid(s: Scene) {
  const grid = cropPictureSize(s.photo.size, PICTURE_ROWS, WIDTH)
  if (!grid) throw new Error('no room')
  const dots = sampleDots(s.photo.thumb, grid.cols, grid.rows)
  return { grid, dots, box: dotBoxOf(s.photo.size, s.box, dots) }
}

const runsToCells = (row: Row, canvas: string): Cell[] =>
  row.flatMap((run) =>
    [...run.text].map((ch) => ({ ch, fg: run.fg ?? canvas, bg: run.bg ?? canvas, b: run.bold })),
  )

/* ------------------------------------------------------------ screens */

/** The picture alone, as `CropStep` draws it, with a cell of canvas round it. */
function screen(L: Look, s: Scene): Grid {
  const { dots, box } = laid(s)
  const picture = cropPictureRows({ palette: L.p, dots, box, edge: L.mode }).map((r) =>
    runsToCells(r, L.canvas),
  )
  const blank = (n: number): Cell[] =>
    Array.from({ length: n }, () => ({ ch: ' ', fg: L.canvas, bg: L.canvas }))
  const across = (picture[0] as Cell[]).length
  return [
    blank(across + 2),
    ...picture.map((row) => [...blank(1), ...row, ...blank(1)]),
    blank(across + 2),
  ]
}

/* ------------------------------------------------------------- render */

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = {
  '╱': 'd',
  '▀': 'u',
  '▄': 'l',
  '▕': 're',
  '▏': 'le',
  '▁': 'be',
  '▔': 'te',
}
function html(g: Grid, canvas: string): string {
  const body = g
    .map((r) => {
      let out = ''
      for (const cell of r) {
        const st = `color:${cell.fg};background:${cell.bg}${cell.b ? ';font-weight:700' : ''}`
        const inner = GLYPH[cell.ch] ? `<i class="${GLYPH[cell.ch]}"></i>` : esc(cell.ch)
        out += `<span style="${st}">${inner}</span>`
      }
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${canvas}">${body}</div>`
}

/* --------------------------------------------------------------- page */

const shot = process.argv[2]
if (!shot) throw new Error('usage: npx tsx scripts/crop-frame-mockup.ts <screenshot.png>')
const chess = await photoOf(shot)
const meadow = await photoOf('/tmp/forge-crop/scene.png')
// The meadow is drawn at 4032 × 3024 in round one; its PNG is that size.
const portrait = { w: 4, h: 5 }
const wide = { w: 16, h: 9 }
const square = { w: 1, h: 1 }
const meadowSquare = await guessCrop(meadow, square)
const SCENES: Scene[] = [
  // Where the crop sat in the screenshot that showed the "double line": just
  // under the app's purple graph line.
  {
    name: 'Screenshot, 4:5',
    label: '4:5',
    photo: chess,
    box: { ...largestBox(chess.size, portrait), top: 40 },
  },
  { name: 'Meadow, 16:9', label: '16:9', photo: meadow, box: await guessCrop(meadow, wide) },
  {
    name: 'Meadow, 1:1 zoomed in',
    label: '1:1',
    photo: meadow,
    box: zoomedBox(
      meadow.size,
      square,
      {
        x: meadowSquare.left + meadowSquare.width * 0.62,
        y: meadowSquare.top + meadowSquare.height * 0.45,
      },
      50,
    ),
  },
]

const themes = [DARK, LIGHT].map((base) => {
  const L = lookOf(base)
  return SCENES.map(
    (s) =>
      `<div class="shot ${L.name}"><div class="cap">${s.name}${L.name === 'light' ? ' · light' : ''}</div>${html(screen(L, s), L.canvas)}</div>`,
  ).join('')
})
const figure = `<figure id="G" class="row"><div class="about"><div class="vt"><span class="id">G</span><span class="name">Corner brackets</span><span class="tag">DECIDED</span></div><p class="idea">Purple L-shapes on the crop’s four corners, inside it: arms one dot thick, a quarter of the shorter side long (at least two dots). The cut part stays faded and hatched, so what is cut can still be seen.</p></div>${themes.join('')}</figure>`

const css = readFileSync(new URL('./crop-frame-mockup.css', import.meta.url), 'utf8')
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Crop edge</title><style>${css}</style></head>
<body class="only-dark"><main>
<h1>Crop to shape · showing the edge</h1>
<p class="lede">At 80 × 24 the preview picture is about 15 × 13 cells, and the hatch alone does not say where the cut falls. Drawn on three crops: the chess screenshot at 4:5, the meadow at 16:9, and the meadow at 1:1 zoomed in so all four sides are cut.</p>
<div class="status"><b>SCREEN</b> · decided 2026-10-13: G.</div>
<div class="bar"><label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label>
<label><input type="checkbox" id="big"> zoom 2×</label></div>
${figure}
</main>
<script>
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.classList.remove('only-dark','only-light','both'); document.body.classList.add(r.value) })
document.getElementById('big').onchange = (e) => document.body.classList.toggle('big', e.target.checked)
const q = new URLSearchParams(location.search)
if (q.get('theme')) { const v = q.get('theme') === 'both' ? 'both' : 'only-' + q.get('theme'); document.body.classList.remove('only-dark'); document.body.classList.add(v); const r = document.querySelector('input[value="' + v + '"]'); if (r) r.checked = true }
if (q.get('big')) document.body.classList.add('big')
</script></body></html>`

const out = new URL('../mockups/crop-frame-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
