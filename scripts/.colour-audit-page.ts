/**
 * The colour UX audit page (mockups/colour-audit-2026-10.html): real screens
 * captured by scripts/colour-audit-capture.tsx, with numbered pins on the
 * findings. `--thread` writes a copy with absolute image paths for T3.
 */
import { readFileSync, writeFileSync } from 'node:fs'
const frames: Array<{ id: string; rows: Array<Array<{ ch: string }>> }> = JSON.parse(
  readFileSync('/tmp/colour-audit/frames.json', 'utf8'),
)
const text = (id: string) => frames.find((f) => f.id === id)!.rows.map((r) => r.map((c) => c.ch).join(''))
/** Where `find` is on screen `id`, as % of the screenshot: its first cell, centred on the row. */
function at(id: string, find: string, nth = 0): { x: number; y: number } {
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
type Pin = [n: number, find: string, nth?: number, dx?: number]
const thread = process.argv.includes('--thread')
const src = (id: string) =>
  thread ? `/Users/atharvanayak/Developer/Convert Terminal/mockups/colour-audit-2026-10/${id}.webp` : `colour-audit-2026-10/${id}.webp`
function shot(id: string, caption: string, pins: Pin[] = []) {
  const dots = pins
    .map(([n, find, nth = 0, dx = 0]) => {
      const p = at(id, find, nth)
      return `<a class="pin s${sev(n)}" href="#f${n}" style="left:max(1px, calc(${p.x}% - 23px + ${dx}px));top:calc(${p.y}% - 10px)">${n}</a>`
    })
    .join('')
  return `<figure><div class="shot"><img src="${src(id)}" alt="${id}">${dots}</div><figcaption>${caption}</figcaption></figure>`
}

interface Finding { n: number; sev: 1 | 2 | 3; title: string; body: string; rule: string; touches?: string }
const F: Finding[] = [
  { n: 1, sev: 1, title: 'The three cards don’t say which job they do',
    body: 'Two of the three subtitles end “from one colour”. Someone holding a brand hex can’t tell <b>Scale</b> from <b>Palette</b>. Someone who wants “a palette” finds two cards that make one: <b>Extract</b> (from a photo) and <b>Palette</b> (from a colour). The names describe what the code does, not what the user has or wants.',
    rule: 'Match the real world', touches: 'C1 three cards (2026-10-13)' },
  { n: 2, sev: 1, title: 'Nothing says what the result is for, or when you’re done',
    body: 'Every screen ends in <code>c copy all</code>. What it copies is an SVG card that only makes sense pasted into Figma; pasted into Notes or VS Code it’s a wall of markup. The word “Figma” appears nowhere. <code>↵ copy</code> copies the hex only, while the screen also shows rgb() and oklch(). There’s no finish line: people don’t know they’ve got what they came for.',
    rule: 'Visibility of system status' },
  { n: 3, sev: 1, title: 'Ten tools behind three cards',
    body: 'Count what’s in the mode: Extract, go deeper, Scale, Neutral, Alpha, Mix, make centre, Tweak (4 sliders), Steps (3 sets, up to 4 values), Palette, and 7 palette modes. Mix has no card at all; the only way in is the <code>⇧ →</code> chip in the field. A first-time user meets alpha, oklch and contrast ratios before they’ve got one plain result. Nothing is ranked: every tool is on screen at the same weight.',
    rule: 'Progressive disclosure' },
  { n: 4, sev: 1, title: 'The same key means different things on different screens',
    body: 'There’s no shared key grammar, so nothing learnt on one screen carries to the next. <code>s</code> is “scale” on Extract but “steps” everywhere else. <code>r</code> is “make centre” on Scale but “reset” on Palette and in Tweak. <code>←→</code> does five different jobs. <code>A S D</code> are keyboard positions, not letters, so only S matches its card. See the key map below.',
    rule: 'Consistency and standards' },
  { n: 5, sev: 2, title: 'Key hints are spread over four rows',
    body: 'On Scale, keys are taught in four places: <code>⇧ →</code> in the field, <code>tab switch</code> on the tab row, <code>t tweak · s steps</code> under the ramp, and six more in the key row. Everywhere else in Forge the key row is where you look; here it’s missing four of the keys, so the eye has to hunt.',
    rule: 'Recognition over recall' },
  { n: 6, sev: 2, title: 'A wall of jargon',
    body: 'One Scale screen shows <code>oklch(63% 0.196 273)</code>, <code>3.6:1</code>, <code>normal / large</code>, <code>AA / AAA</code>, <code>Tailwind 50 – 950</code>. The other tabs add <code>#0021FC9A</code>, “60% opaque”, “over white” and “soft tint”. Mix adds “OKLab straight across”, Steps adds “Tailwind / Even / Radix”, and the modes are Analogous, Split complementary, Triadic. Designers know some of these words; most people know none.',
    rule: 'Match the real world' },
  { n: 7, sev: 2, title: 'What you came for isn’t the biggest thing on screen',
    body: 'On Scale, the preview block and contrast table weigh more than the ramp, which is the actual result. The chosen step is marked only by a thin <code>▔</code> under it. On Palette, “your colour” is a tiny unexplained corner mark (◤ or ▖).',
    rule: 'Visual hierarchy' },
  { n: 8, sev: 2, title: 'Three tools, three layouts, three ways to choose',
    body: 'Extract is a vertical list, marked with a <code>▌</code> bar, moved with ↑↓. Scale and Mix are a horizontal ramp, marked with a <code>▔</code> underline, moved with ←→. Palette is a grid with a framed cell, moved with ↑↓←→. Learning one doesn’t help with the next.',
    rule: 'Consistency and standards' },
  { n: 9, sev: 2, title: 'The Tweak window covers what it changes',
    body: 'Tweak opens in the middle, over the ramp or grid. You move brightness while the swatches you’re changing are hidden; the only feedback is a thin chip strip inside the window. The Mode list covers the grid the same way, though its chips do help.',
    rule: 'Direct manipulation', touches: 'W1 centred window (2026-10-13)' },
  { n: 10, sev: 2, title: 'Palette hides half its rows',
    body: 'At 80×26 you see red to teal: 5 of 9 rows. Blue, purple, pink and neutral sit below, and the only sign of them is a thin scrollbar. The mode name (“Full set”) sits alone at the bottom left with no label, so it reads like a heading for nothing.',
    rule: 'Visibility' },
  { n: 11, sev: 2, title: 'Dead ends between the tools',
    body: 'Extract → Scale (<code>s</code>) and Scale → Mix (<code>⇧→</code>) exist. Palette → one row’s scale, Scale → Palette, and an extracted colour → Palette don’t. <code>esc</code> on Palette drops you on colour’s home and the colour is gone. The obvious chain, “photo → pick the brand colour → build a palette”, can’t be done.',
    rule: 'User control and flow' },
  { n: 12, sev: 2, title: 'Empty screens don’t show what you’ll get',
    body: 'Scale and Palette open on dashed skeletons with a long placeholder. The key row already says <code>↵ done</code> before anything is typed. The home cards preview the result; the screens they open drop the preview.',
    rule: 'Help users get started' },
  { n: 13, sev: 3, title: '“copied 11 swatches”, but as what, and where do they go?',
    body: 'The confirmation doesn’t say it’s a Figma card, so people paste it into the wrong place.', rule: 'Feedback' },
  { n: 14, sev: 3, title: '“make centre” is abstract, and its message lingers',
    body: '<code>r</code> swaps in a different colour as a new screen. After esc, “#4351B7 is now 500 · esc goes back to #6579FD” stays up for a moment, describing a screen you’ve already left.', rule: 'Feedback' },
  { n: 15, sev: 3, title: 'Go deeper reads in circles',
    body: 'The first shade often has the same hex as its parent: “#89B929 36% of #89B929”. The trail uses a hex as a place name: Extract ╱ #89B929.', rule: 'Clarity' },
  { n: 16, sev: 3, title: '“wrong input” blames the user and offers no example',
    body: 'Pressing # and then typing a word gives “#banana”, which can never be read.', rule: 'Error recovery' },
  { n: 17, sev: 3, title: 'The photo note is the longest text on screen',
    body: '“The image preview is for illustrative purposes only; the terminal cannot display the actual image.” Two lines, every time, in the terminal you test in (Apple Terminal).', rule: 'Minimalism' },
  { n: 18, sev: 3, title: 'The frame’s colours compete with the swatches',
    body: 'The rainbow hatched bar, the pink chip and the green/red AA ✗ marks all fight the swatches, which should be the only colour on screen. You’ve said colour overload bothers you.', rule: 'Minimalism' },
  { n: 19, sev: 3, title: 'The steps editor works in place, with weak focus',
    body: 'In <code>‹ Tailwind ›  from 50  to 950  11 steps</code> it’s hard to tell which value <code>←→</code> will change. tab cycles through the values, and Radix hides some of them.', rule: 'Visibility' },
]
const sev = (n: number) => F.find((f) => f.n === n)!.sev
const SEV = { 1: 'Critical', 2: 'Major', 3: 'Minor' } as const

const keyMap: Array<[string, string[]]> = [
  ['s', ['scale (Extract)', 'steps (Scale, Mix, Palette)', 'opens Scale (home)']],
  ['r', ['make centre (Scale)', 'reset tweaks (Palette)', 'reset (Tweak window)']],
  ['#', ['new colour, stays (Scale, Palette)', 'leaves for Scale (Extract)', 'opens Scale (home)']],
  ['←→', ['choose a step (Scale, Mix)', 'go deeper / back (Extract)', 'move a column (Palette)', 'change a value (Steps)', 'move a slider (Tweak)']],
  ['⇧→', ['start a mix (Scale)', 'jump 10 (Tweak)']],
  ['tab', ['switch tab (Scale)', 'next value (Steps)']],
  ['esc', ['cancel typing', 'back one screen', 'leave colour mode', 'undo the edit (Steps, Tweak)']],
  ['A S D', ['Extract · Scale · Palette — positions, not letters']],
]

const css = `
  .au{font:14px/1.5 var(--font-sans,system-ui);color:var(--foreground)}
  .au h2{font-size:17px;margin:28px 0 8px}
  .au h3{font-size:14px;margin:0 0 4px}
  .au p{margin:6px 0}
  .au code{font:12.5px var(--font-mono,ui-monospace,monospace);background:var(--code-background,rgba(127,127,127,.15));padding:0 4px;border-radius:4px}
  .verdict{display:grid;gap:8px;margin:8px 0 4px}
  .verdict div{border-left:3px solid var(--accent,#e2789c);padding:2px 0 2px 12px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:560px){.grid2{grid-template-columns:1fr}}
  figure{margin:0}
  .shot{position:relative;border-radius:8px;overflow:hidden;line-height:0}
  .shot img{width:100%;display:block}
  figcaption{font-size:12.5px;color:var(--muted-foreground);margin-top:5px}
  .pin{position:absolute;width:20px;height:20px;border-radius:50%;font:700 11px/20px var(--font-sans,system-ui);text-align:center;color:#fff;text-decoration:none;box-shadow:0 0 0 2px rgba(0,0,0,.55)}
  .s1{background:#e5484d}.s2{background:#e8a33d;color:#1a1a1a}.s3{background:#7a7a7a}
  .step{display:grid;grid-template-columns:28px 1fr;gap:10px;margin:14px 0}
  .step .no{width:24px;height:24px;border-radius:50%;border:1.5px solid var(--border);text-align:center;line-height:22px;font-size:12px;font-weight:700}
  .think{color:var(--muted-foreground);font-style:italic}
  .f{display:grid;grid-template-columns:30px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--border)}
  .f .pin{position:static;display:inline-block;box-shadow:none}
  .tag{font-size:11.5px;color:var(--muted-foreground)}
  .tag b{font-weight:600}
  .touch{font-size:11.5px;color:var(--warning,#e8a33d)}
  table.km{border-collapse:collapse;width:100%;font-size:13px}
  table.km td{border-top:1px solid var(--border);padding:6px 8px;vertical-align:top}
  table.km td:first-child{font:600 13px var(--font-mono,monospace);white-space:nowrap;width:60px}
  .chips span{display:inline-block;margin:2px 6px 2px 0;padding:1px 8px;border-radius:10px;background:var(--secondary,rgba(127,127,127,.15));font-size:12.5px}
  .legend span{display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:12.5px}
  .legend i{width:12px;height:12px;border-radius:50%;display:inline-block}
  ol.pr{padding-left:20px} ol.pr li{margin:8px 0}
`
const findingsHtml = F.map(
  (f) => `<div class="f" id="f${f.n}"><div><span class="pin s${f.sev}">${f.n}</span></div><div><h3>${f.title}</h3><p>${f.body}</p><div class="tag"><b>${SEV[f.sev]}</b> · ${f.rule}</div>${f.touches ? `<div class="touch">Reopens a decision: ${f.touches}</div>` : ''}</div></div>`,
).join('')

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Colour mode — UX audit</title><style>${thread ? '' : ':root{--background:#161616;--foreground:#e8e8e8;--muted-foreground:#a0a0a0;--border:#333;--font-mono:ui-monospace,Menlo,monospace} body{background:var(--background);max-width:860px;margin:30px auto;padding:0 20px}'}${css}</style></head><body><div class="au">

<p class="legend"><span><i class="s1"></i>Critical: blocks a first-time user</span><span><i class="s2"></i>Major: slows or misleads</span><span><i class="s3"></i>Minor: polish</span></p>

<h2>The verdict</h2>
<div class="verdict">
<div><b>Built feature by feature, not around the job.</b> Each round added a capability where it fit (a tab, a window, a key, a chip). The mode now holds about ten tools, and none of them leads.</div>
<div><b>No main path.</b> Every screen shows every option at once, all at the same weight. Nothing says “do this first” or “you’re done”.</div>
<div><b>No shared key grammar.</b> Each of the three tools uses its own keys, so what you learn on one screen doesn’t help on the next.</div>
<div><b>The output is invisible.</b> The real deliverable, a card you paste into Figma, is hidden behind “copy all”.</div>
</div>

<h2>Where a first-time user gets lost</h2>
<p>Task: <i>“I have our brand colour, #6579FD. Get me colours for a design.”</i> Recorded on dev, 80×26, dark theme.</p>

<div class="step"><div class="no">1</div><div>${shot('home', 'Colour’s home: three cards, two of them “from one colour”.', [[1, 'S Scale'], [1, 'D Palette'], [4, 'A S D']])}<p class="think">“I have one colour… Scale or Palette? What’s the difference?”</p></div></div>

<div class="step"><div class="no">2</div><div><div class="grid2">${shot('scale-empty', 'Scale, empty: a skeleton, and “↵ done” before anything is typed.', [[12, '↵  done'], [12, '╌╌╌╌╌', 4]])}${shot('palette-empty', 'Palette, empty: six dashed rows, no sense of what will appear.', [[12, '╌╌╌╌', 3]])}</div><p class="think">“What will I get if I type here?”</p></div></div>

<div class="step"><div class="no">3</div><div>${shot('scale', 'Scale, filled: key hints on four rows, jargon in the lower half, and the result (the ramp) isn’t the strongest thing on screen.', [[3, '⇧ →'], [5, 'tab '], [5, 't  tweak'], [6, 'Tailwind'], [7, '▔▔▔▔▔', 0, 140], [6, 'oklch'], [6, 'white'], [5, '←→'], [3, 'Neutral'], [3, 'Alpha']])}<p class="think">“Okay, a ramp. AA? 3.6:1? Do I need the Alpha tab? What do I do now?”</p></div></div>

<div class="step"><div class="no">4</div><div><div class="grid2">${shot('scale-alpha', 'Alpha tab: an 8-digit hex and “over white”: an expert idea, shown at full weight.', [[6, '#0021FC9A', 0, 0], [3, 'Alpha']])}${shot('scale-tweak', 'Tweak: the window covers the ramp it changes.', [[9, 'Tweak'], [19, 'r reset']])}</div></div></div>

<div class="step"><div class="no">5</div><div><p>They press <code>c copy all</code>. “✓ copied 11 swatches.” They paste into Slack, Notes or VS Code and get SVG markup. <b>Nothing ever said “Figma”.</b> <a href="#f2" class="pin s1" style="position:static;display:inline-block">2</a> <a href="#f13" class="pin s3" style="position:static;display:inline-block">13</a></p></div></div>

<div class="step"><div class="no">6</div><div>${shot('palette', 'Palette, from the home screen with the hex typed again: 5 of 9 rows visible, an unlabelled mode name, and an unexplained “your colour” mark.', [[10, '┃'], [10, 'Full set'], [7, '╭────╮', 0, 0], [8, '↑↓←→'], [11, 'esc back']])}<p class="think">“Where are blue and purple? What’s ‘Full set’? And why did I have to type the hex again?”</p></div></div>

<div class="step"><div class="no">7</div><div><div class="grid2">${shot('palette-mode', 'Mode: colour-theory names (Analogous, Triadic…). The chips help; the words don’t.', [[6, 'Split complementary']])}${shot('extract', 'Extract: a fourth layout, a third selection mark, and the longest text on screen is a disclaimer.', [[17, 'illustrative'], [8, '▌'], [4, 's scale']])}</div></div></div>

<h2>The key map</h2>
<p>The same key does different jobs depending on the screen. This is the biggest reason people “need guidance”.</p>
<table class="km">${keyMap.map(([k, uses]) => `<tr><td>${k}</td><td class="chips">${uses.map((u) => `<span>${u}</span>`).join('')}</td></tr>`).join('')}</table>

<h2>All findings</h2>
${findingsHtml}

<h2>What the redesign should do</h2>
<p>Principles to carry into the mockups. Not mockups yet.</p>
<ol class="pr">
<li><b>Start from what the user has.</b> A photo or a colour: two ways in, not three tools. A colour leads to one result first, then grows (“a scale → the rest of the palette”), instead of two cards that both say “from one colour”.</li>
<li><b>One plain result first, everything else on request.</b> Neutral, Alpha, Mix, Tweak, Steps and Modes move into one “more” place, opened by one key, instead of sitting across four rows of every screen.</li>
<li><b>Name the way out.</b> The copy actions say where the colours go (e.g. Figma, or a hex). Any new words are listed for your approval first.</li>
<li><b>One key grammar across colour mode.</b> Arrows always move the selection, ↵ always copies the chosen colour, one letter for each verb everywhere, and every key lives in the key row.</li>
<li><b>One layout family and one selection mark.</b> A palette is ramps stacked; an extract is a list of the same swatches. The chosen colour is marked the same way on every screen.</li>
<li><b>Words before numbers.</b> oklch, contrast ratios and alpha hex become details you open, not the first thing you read.</li>
<li><b>Tools hand off to each other.</b> From any colour you can go to its scale or its palette without typing it again.</li>
</ol>
</div></body></html>`
writeFileSync(thread ? '/tmp/colour-audit/thread.html' : 'mockups/colour-audit-2026-10.html', html)
console.log('ok', html.length)
