import { writeFileSync } from 'node:fs'
const img = (id: string) => `/Users/atharvanayak/Developer/Convert Terminal/mockups/colour-redesign-2026-10/${id}.webp`
const step = (n: number, title: string, id: string, k: string) =>
  `<figure><figcaption><span class="n">${n}</span>${title}</figcaption><img src="${img(id)}"><div class="k">${k}</div></figure>`
const opt = (id: string, title: string, shot: string, note: string, pick = false) =>
  `<figure class="${pick ? 'pick' : ''}"><figcaption><span class="o">${id}</span>${title}${pick ? '<span class="mp">my pick</span>' : ''}</figcaption><img src="${img(shot)}"><div class="k">${note}</div></figure>`
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
.au{font:15px/1.5 var(--font-sans,system-ui);color:var(--foreground)}
.rules{display:grid;gap:6px;margin:4px 0 10px}
.rules div{display:flex;gap:10px;align-items:center}
.rules b{flex:none;width:24px;height:24px;border-radius:50%;background:#e8a33d;color:#1a1a1a;display:grid;place-items:center;font-size:13px}
h2{font-size:18px;margin:30px 0 4px}
h3{font-size:15px;margin:22px 0 8px}
.sub{color:var(--muted-foreground);margin:0 0 10px;font-size:14px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px 14px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media (max-width:560px){.g2,.g3{grid-template-columns:1fr}}
figure{margin:0}
figure img{width:100%;display:block;border-radius:6px}
figcaption{font-weight:600;font-size:14px;margin:0 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.n{flex:none;width:22px;height:22px;border-radius:50%;border:1.5px solid var(--border);display:grid;place-items:center;font-size:12px}
.o{font:700 11.5px var(--font-mono,monospace);padding:1px 6px;border-radius:4px;background:var(--secondary,rgba(127,127,127,.2))}
.mp{font:700 10.5px var(--font-mono,monospace);text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;color:#e8a33d;border:1px solid #e8a33d}
figure.pick img{outline:2px solid #e8a33d;outline-offset:2px}
.k{font:12.5px var(--font-mono,monospace);color:var(--muted-foreground);margin-top:5px}
.words{font-size:14px;color:var(--muted-foreground)}
.words b{color:var(--foreground);font-weight:600}
</style></head><body><div class="au">
<div class="rules">
<div><b>1</b>Two ways in: drop a photo, or type a colour.</div>
<div><b>2</b>A colour opens on its Shades. tab shows its Palette.</div>
<div><b>3</b>Same keys on every screen. Extras live in one list: m more.</div>
</div>

<h2>Flow 1 — I have a colour</h2>
<div class="g2">
${step(1, 'Colour’s home', 'home', 'looks like every other mode')}
${step(2, 'Type a colour', 'typed', 'type · ↵ open')}
${step(3, 'Its shades', 'shades', '←→ choose · ↵ copy hex')}
${step(4, 'Copy for Figma', 'copied', 'c')}
${step(5, 'Its palette', 'palette', 'tab · all 9 rows show')}
${step(6, 'More', 'more', 'm · the extras, in one list')}
${step(7, 'Adjust', 'adjust', 'sliders at the bottom; colours stay in view')}
</div>

<h2>Flow 2 — I have a photo</h2>
<p class="sub">Drop it on colour’s home (step 1 above).</p>
<div class="g3">
${step(2, 'Its colours', 'photo', '↵ copy · → open')}
${step(3, 'Open one', 'photoShades', 'the same Shades screen')}
${step(4, 'Its palette', 'photoPalette', 'tab')}
</div>

<h2>Pick one option for each</h2>
<h3>A · What goes under the shades?</h3>
<div class="g3">
${opt('A1', 'One line', 'a1', 'step and hex only')}
${opt('A2', 'The colour, big', 'shades', 'text on it, and its codes', true)}
${opt('A3', 'Palette under it', 'a3', 'no tabs; other colours as thin rows')}
</div>
<h3>B · Where do the extras live?</h3>
<div class="g3">
${opt('B1', 'A list on m', 'more', 'hidden until you ask', true)}
${opt('B2', 'More tabs', 'b2', 'always in view')}
${opt('B3', 'A strip over the keys', 'b3', 'each extra on its own key')}
</div>
<h3>C · Colour’s home</h3>
<div class="g2">
${opt('C1', 'Drop zone + field', 'home', 'same as every mode', true)}
${opt('C2', 'Two cards', 'c2', 'Photo or Colour')}
</div>

<h2>Words to approve</h2>
<p class="words"><b>Drop a photo here · OR type a colour · open · Shades · Palette · copy for Figma · copied for Figma · more · Blend with a colour · See-through · Adjust · Steps · white text · black text · % of the photo</b></p>
<p class="words">Kept, not shown here: make centre, the grey’s tint, palette style and “go deeper” go into More on the screen they belong to.</p>
</div></body></html>`
writeFileSync('/tmp/colour-audit/redesign-thread.html', html)
console.log(html.length)
