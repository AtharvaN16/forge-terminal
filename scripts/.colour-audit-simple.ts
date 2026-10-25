/**
 * The colour UX audit in plain language, short (asked for 2026-10-23):
 * mockups/colour-audit-2026-10-simple.html. `--thread` → absolute image paths.
 */
import { readFileSync, writeFileSync } from 'node:fs'
const frames: Array<{ id: string; rows: Array<Array<{ ch: string }>> }> = JSON.parse(
  readFileSync('/tmp/colour-audit/frames.json', 'utf8'),
)
const text = (id: string) => frames.find((f) => f.id === id)!.rows.map((r) => r.map((c) => c.ch).join(''))
function at(id: string, find: string, nth = 0) {
  const rows = text(id)
  let seen = 0
  for (let r = 0; r < rows.length; r++) {
    let c = rows[r]!.indexOf(find)
    while (c >= 0) {
      if (seen++ === nth) return { x: ((32 + c * 15.65) / 1316) * 100, y: ((28 + r * 34 + 17) / 940) * 100 }
      c = rows[r]!.indexOf(find, c + 1)
    }
  }
  throw new Error(`${id}: no ${find}`)
}
const thread = process.argv.includes('--thread')
const src = (id: string) =>
  thread ? `/Users/atharvanayak/Developer/Convert Terminal/mockups/colour-audit-2026-10/${id}.webp` : `colour-audit-2026-10/${id}.webp`
type Pin = [label: string, find: string, nth?: number, dx?: number]
function shot(id: string, pins: Pin[] = []) {
  const dots = pins
    .map(([l, find, nth = 0, dx = 0]) => {
      const p = at(id, find, nth)
      return `<span class="pin" style="left:max(1px, calc(${p.x}% - 25px + ${dx}px));top:calc(${p.y}% - 11px)">${l}</span>`
    })
    .join('')
  return `<div class="shot"><img src="${src(id)}" alt="">${dots}</div>`
}
const notes = (items: string[]) =>
  `<ol class="notes">${items.map((t, i) => `<li><span class="pin s">${i + 1}</span>${t}</li>`).join('')}</ol>`
const problem = (n: number, title: string, body: string) =>
  `<section><h2><span class="n">${n}</span>${title}</h2>${body}</section>`

const css = `
  .au{font:15px/1.5 var(--font-sans,system-ui);color:var(--foreground)}
  .lead{font-size:19px;font-weight:600;margin:4px 0 2px}
  .sub{color:var(--muted-foreground);margin:0 0 8px}
  section{margin:34px 0}
  h2{font-size:17px;margin:0 0 10px;display:flex;align-items:center;gap:10px}
  .n{flex:none;width:26px;height:26px;border-radius:50%;background:#e5484d;color:#fff;font-size:13px;display:grid;place-items:center}
  .shot{position:relative;border-radius:8px;overflow:hidden;line-height:0}
  .shot img{width:100%;display:block}
  .pin{position:absolute;width:22px;height:22px;border-radius:50%;background:#e8a33d;color:#1a1a1a;font:700 12px/22px var(--font-sans,system-ui);text-align:center;box-shadow:0 0 0 2px rgba(0,0,0,.6)}
  .pin.s{position:static;display:inline-block;box-shadow:none;margin-right:10px;flex:none}
  .notes{list-style:none;padding:0;margin:10px 0 0}
  .notes li{display:flex;align-items:center;margin:6px 0}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:560px){.two{grid-template-columns:1fr}}
  .cap{font-size:14px;margin-top:6px}
  .keys{display:grid;gap:10px}
  .key{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .cap-k{font:700 15px var(--font-mono,ui-monospace,monospace);min-width:44px;text-align:center;padding:6px 10px;border-radius:6px;background:var(--secondary,rgba(127,127,127,.2));border-bottom:3px solid var(--border)}
  .means{padding:4px 10px;border-radius:14px;border:1px solid var(--border);font-size:14px}
  .paste{display:grid;grid-template-columns:auto 30px 1fr;align-items:center;gap:10px}
  .chip{font:600 14px var(--font-mono,monospace);padding:8px 12px;border-radius:6px;background:var(--secondary,rgba(127,127,127,.2));white-space:nowrap}
  .arrow{text-align:center;font-size:20px;color:var(--muted-foreground)}
  .code{font:11px/1.4 var(--font-mono,monospace);color:var(--muted-foreground);background:var(--code-background,rgba(127,127,127,.12));border-radius:6px;padding:10px;height:88px;overflow:hidden;word-break:break-all;-webkit-mask-image:linear-gradient(#000 55%,transparent)}
  .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}
  .flow .box{padding:8px 12px;border-radius:8px;border:1px solid var(--border)}
  .flow .no{border-color:#e5484d;color:#e5484d;text-decoration:line-through}
  .small li{margin:4px 0}
  .fix{display:grid;gap:8px;padding:0;list-style:none;counter-reset:f}
  .fix li{padding:10px 14px;border-radius:8px;background:var(--secondary,rgba(127,127,127,.12));counter-increment:f}
  .fix li::before{content:counter(f);font-weight:700;color:#46a758;margin-right:10px}
  .ok{border:1px solid var(--warning,#e8a33d);border-radius:8px;padding:12px 16px;margin-top:16px}
  .ok b{color:var(--warning,#e8a33d)}
`
const svg = readFileSync('/dev/stdin', 'utf8').slice(0, 700).replace(/&/g, '&amp;').replace(/</g, '&lt;')

const body = `
<p class="lead">People get lost because colour mode shows everything at once.</p>
<p class="sub">Six problems, most important first. Screens are from the real app.</p>

${problem(1, 'Two cards sound the same', `
${shot('home', [['1', 'create shades', 0, 0], ['1', 'build a palette', 0, 0]])}
<p class="cap">Scale and Palette both say <b>“from one colour”</b>. If you have one colour, which do you pick?</p>`)}

${problem(2, 'Too much on one screen', `
${shot('scale', [['1', '⇧ →'], ['1', 'tab '], ['1', 't  tweak'], ['1', '←→'], ['2', 'Neutral'], ['3', 'oklch'], ['3', 'white'], ['4', '▔▔▔▔▔', 0, 140]])}
${notes([
  'Key tips in four different places. Your eye has to hunt for them.',
  'Tabs most people will never need (Neutral, Alpha).',
  'Technical numbers: oklch, 3.6:1, AA, AAA.',
  'The colours you came for are marked with only a thin line.',
])}`)}

${problem(3, 'You can’t tell where the result goes', `
<div class="paste"><div class="chip">c&nbsp; copy all</div><div class="arrow">→</div><div class="code">${svg}</div></div>
<p class="cap">It’s made to paste into <b>Figma</b>, but nothing says so. Paste it anywhere else and you get a page of code.</p>`)}

${problem(4, 'The same key does different things', `
<div class="keys">
<div class="key"><span class="cap-k">s</span><span class="means">scale</span><span class="means">steps</span><span class="means">open Scale</span></div>
<div class="key"><span class="cap-k">r</span><span class="means">make centre</span><span class="means">reset</span></div>
<div class="key"><span class="cap-k">←→</span><span class="means">pick a colour</span><span class="means">go deeper</span><span class="means">change a setting</span><span class="means">move a slider</span></div>
</div>
<p class="cap">What you learn on one screen doesn’t work on the next.</p>`)}

${problem(5, 'Things are hidden', `
<div class="two">
<div>${shot('palette', [['1', '┃']])}<p class="cap">Only 5 of 9 rows show. Blue, purple, pink and grey are below, with no sign they’re there.</p></div>
<div>${shot('scale-tweak', [['2', 'Tweak']])}<p class="cap">The Tweak box covers the colours it’s changing.</p></div>
</div>`)}

${problem(6, 'You have to start over', `
<div class="flow"><span class="box">Photo</span>→<span class="box">pick a colour</span>→<span class="box no">make a palette from it</span></div>
<p class="cap">The tools don’t connect. To go from Scale to Palette you type the colour again, and going back from Palette throws it away.</p>`)}

<section><h2 style="gap:0">Small things</h2>
<ul class="small">
<li>“copied 11 swatches”: copied as what?</li>
<li>“make centre” is hard to understand.</li>
<li>“wrong input” doesn’t show an example of what works.</li>
<li>The longest text on the photo screen is a two-line disclaimer.</li>
<li>The rainbow header and the green/red marks compete with the colours.</li>
</ul></section>

<section><h2 style="gap:0">How we fix it</h2>
<ol class="fix">
<li><b>Two ways in:</b> a photo or a colour.</li>
<li><b>One clear result first.</b> Extras behind one key.</li>
<li><b>Say where it goes:</b> “copy for Figma”.</li>
<li><b>Same keys on every screen.</b> All tips in the bottom row.</li>
<li><b>Move between tools</b> without typing the colour again.</li>
</ol>
<div class="ok"><b>Needs your OK:</b> two of these fixes undo earlier decisions. The three cards become two ways in, and the Tweak box moves out of the middle of the screen.</div>
</section>`
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Colour mode — what’s confusing</title><style>${thread ? '' : ':root{--background:#161616;--foreground:#e8e8e8;--muted-foreground:#a0a0a0;--border:#3a3a3a;--secondary:#262626} body{background:var(--background);max-width:760px;margin:30px auto;padding:0 20px}'}${css}</style></head><body><div class="au">${body}</div></body></html>`
writeFileSync(thread ? '/tmp/colour-audit/simple-thread.html' : 'mockups/colour-audit-2026-10-simple.html', html)
console.log('ok', html.length)
