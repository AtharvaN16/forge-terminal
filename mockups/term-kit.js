// Shared by explorations-2026-10.html and motion-2026-10.html.
// Draws terminal screens as lines of [text, class, style] segments.
/* ------------------------------------------------------------------ cells */
const P = { bg:'#17181c', f:'#e4e8f0', n:'#a9afbc', d:'#8b93a6', x:'#5f6879', ghost:'#3c414d', edge:'#30343d', o:'#6fcf7f', w:'#e5c07b',
  kc:'#2e3340', sel:'#252c3a', amber:'#e5a23c', spark:'#ffc247', heat:'#ff8c1a', wood:'#8a5a2b', glint:'#e6fbff', ink:'#0b1a1f' }
const MODES = {
  convert:  { c:'#55c7d9', bg:'#122c33', mark:'↔' },
  compress: { c:'#79c98b', bg:'#182c1e', mark:'⇣' },
  pdf:      { c:'#ff6b4a', bg:'#361c16', mark:'▤' },
}
const SPIN = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
let MOTION = true
const W = 80, H = 24

const hex = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16))
const clamp = k => Math.max(0, Math.min(1, k))
const mix = (a, b, k) => { k = clamp(k); const A = hex(a), B = hex(b); return '#' + A.map((v,i) => Math.round(v + (B[i]-v)*k).toString(16).padStart(2,'0')).join('') }
const ease = k => MOTION ? 1 - Math.pow(1 - clamp(k), 3) : 1
const chars = s => [...s]
const sp = n => ' '.repeat(Math.max(0, n))
const len = l => l.reduce((n, s) => n + chars(s[0]).length, 0)
const pad = (l, w) => [...l, [sp(w - len(l))]]
const trunc = (s, n) => chars(s).length > n ? chars(s).slice(0, n - 1).join('') + '…' : s
const centre = (l, c) => [[sp(c - Math.floor(len(l) / 2))], ...l]
const fg = c => 'color:' + c
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = lines => lines.map(l => l.map(([t, c, st]) => (c || st) ? `<span class="${c||''}" style="${st||''}">${esc(t)}</span>` : esc(t)).join('')).join('\n')
const explode = l => l.flatMap(([t, c='', st='']) => chars(t).map(ch => [ch, c, st]))
const onBg = (l, bg) => l.map(([t, c='', st='']) => [t, c, (st ? st + ';' : '') + 'background:' + bg])
const flashAt = (t, enter) => MOTION && t >= enter ? 1 - clamp((t - enter) / 320) : 0
const fade = (a, b, k) => MOTION ? mix(a, b, k) : b

function shimmer(text, t, base = P.d, hi = P.glint, period = 1500) {
  if (!MOTION) return [[text, '', fg(base)]]
  const cs = chars(text), p = ((t % period) / period) * (cs.length + 10) - 5
  return cs.map((ch, i) => [ch, '', fg(mix(base, hi, 1 - Math.abs(i - p) / 3.2))])
}
const spin = t => MOTION ? SPIN[Math.floor(t / 80) % SPIN.length] : '•'

/* -------------------------------------------------------------- components */
function headerBar(mode = 'convert', w = W, right = '~/Desktop ') {
  const M = MODES[mode]
  const l = pad([[` ${M.mark} FORGE `, 'b', fg(M.c)], ['  ' + mode, '', fg(P.d)]], w - right.length)
  return onBg([...l, [right, '', fg(P.d)]], M.bg)
}
function wipe(from, to, k, fromBg, toBg) {
  const A = explode(from), B = explode(to), edge = ease(k) * (B.length + 8)
  return B.map((cell, i) => {
    const j = clamp((edge - i) / 6)
    const [ch, c, st] = j > 0.5 ? cell : (A[i] || [' ', '', ''])
    const s = (st || '').replace(/;?background:#[0-9a-f]+/, '')
    return [ch, c, (s ? s + ';' : '') + 'background:' + mix(fromBg, toBg, j)]
  })
}

const CARD = 52
function fileCard(tag = 'PNG', name = 'test.png', meta = '2756×774 · 122 KB · transparent', col = MODES.convert.c) {
  return [
    [['╭─ ', 'x'], [tag, 'b', fg(col)], [' ' + '─'.repeat(CARD - 5 - chars(tag).length) + '╮', 'x']],
    [['│ ', 'x'], [name.padEnd(CARD - 3)], ['│', 'x']],
    [['│ ', 'x'], [meta.padEnd(CARD - 3), 'd'], ['│', 'x']],
    [['╰' + '─'.repeat(CARD - 2) + '╯', 'x']],
  ]
}
const trail = (label, value) => [['✓ ', 'o'], [label.padEnd(13), 'd'], [value, 'b']]
const title = (s, c) => [[s, 'b', fg(c)]]

function hints(keys) {
  return keys.flatMap(([k, label], i) => [[i ? '     ' : ''], [` ${k} `, 'b', fg(P.f) + ';background:' + P.kc], [' ' + label, 'd']])
}
function frame(head, body, keys) {
  const lines = [head, [], ...body.map(l => [[' '], ...l])]
  while (lines.length < H - 1) lines.push([])
  lines.length = H - 1
  lines.push(keys ? hints(keys) : [])
  return lines
}

/* ---------------------------------------------------------------- questions */
const FORMATS = [
  { n:'JPEG', ms:500,  size:'74.6 KB', save:'39% smaller', pct:'−39%' },
  { n:'WebP', ms:700,  size:'41.8 KB', save:'66% smaller', pct:'−66%' },
  { n:'AVIF', ms:1900, size:'33.1 KB', save:'73% smaller', pct:'−73%' },
  { n:'GIF',  ms:900,  size:'96.0 KB', save:'21% smaller', pct:'−21%' },
  { n:'TIFF', ms:400,  size:'131 KB',  save:'7% larger',   pct:'+7%' },
  { n:'PDF',  ms:600,  size:'88.2 KB', save:'28% smaller', pct:'−28%' },
]
const PLACES = [
  ['Desktop', '~/Desktop/'], ['Same folder', '~/Pictures/'], ['Downloads', '~/Downloads/'],
  ['New subfolder', '~/Pictures/converted/'], ['Other…', null],
]
const PAGES = [
  ['1 page each', '12 files', ''], ['2 pages each', '6 files', ''],
  ['Odd and even', '2 files', 'for duplex scans'], ['Custom ranges…', null, ''],
]

// a format's size is known once the cursor has sat on it for its encode time; leaving cancels
function measured(ev, t, i) {
  for (let j = 0; j < ev.length && ev[j][0] <= t; j++) {
    if (ev[j][1] !== i) continue
    const end = Math.min(t, ev[j + 1] ? ev[j + 1][0] : Infinity)
    if (end - ev[j][0] >= FORMATS[i].ms) return ev[j][0] + FORMATS[i].ms
  }
  return null
}

// Every question has the same shape, so every variant can draw every question.
// row.val(on, short) → the number-ish part (size, path, result). Rows carry no notes:
// you asked for none, so row.note is always empty and noteSeg never draws
function makeQ(kind, ev, t) {
  if (kind === 'format') return { kind, title: 'Convert to', sub: 'Pick a format for test.png', mode: 'convert', nw: 6, cols: ['FORMAT', 'SIZE', ''], vw: 24,
    rows: FORMATS.map((F, i) => ({ name: F.n, note: '', val: (on, short) => {
      const at = measured(ev, t, i)
      if (at !== null) return [[F.size, 'b', fg(fade(MODES.convert.c, P.f, (t - at) / 300))], [' ' + (short ? F.pct : ' ' + F.save), '', fg(F.save.includes('larger') ? P.w : P.o)]]
      return on ? shimmer('measuring…', t) : []
    } })) }
  if (kind === 'save') return { kind, title: 'Save to', sub: 'Where should test.jpg go?', mode: 'convert', nw: 13, cols: ['PLACE', 'PATH', ''], vw: 32,
    rows: PLACES.map(([name, dir], i) => ({ name, note: '', isDefault: i === 0,
      val: (on, short) => !dir ? [['type a path', 'x']] : short ? [[trunc(dir, 16), 'd']] : [[dir, 'd'], ['test.jpg', 'b']] })) }
  return { kind, title: 'Pages per file', sub: 'Split report.pdf · 12 pages', mode: 'pdf', nw: 14, cols: ['SPLIT', 'RESULT', ''], vw: 20,
    rows: PAGES.map(([name, res]) => ({ name, note: '',
      val: (on, short) => res ? [[res, 'b']] : [[short ? 'type ranges' : 'e.g. 1-3, 7, 9-12', 'd']] })) }
}
function noteSeg(Q, r) { return [r.note, '', fg(P.d)] }
function detail(Q, i, on = true, short = false) {
  const r = Q.rows[i], v = r.val(on, short)
  return r.note ? [...v, ...(v.length ? [['  ·  ', 'x']] : []), noteSeg(Q, r)] : v
}

/* -------------------------------------------------------------- cursor state */
function cursor(ev, t) {
  let j = 0; while (j + 1 < ev.length && ev[j + 1][0] <= t) j++
  return { idx: ev[j][1], prev: j ? ev[j - 1][1] : null, since: t - ev[j][0] }
}
function stateOf(ev, t, enter = Infinity) { const c = cursor(ev, t); return { ...c, t, k: ease(c.since / 140), flash: flashAt(t, enter) } }
// background behind row i: fades in on the new row and out on the old one
function band(st, i, M) {
  if (i === st.idx) return st.flash ? mix(M.bg, mix(M.bg, M.c, .45), st.flash) : mix(P.bg, M.bg, st.k)
  if (i === st.prev && st.k < 1) return mix(M.bg, P.bg, st.k)
  return null
}
// foreground for row i, same fade
function tint(st, i, from, to) {
  if (i === st.idx) return st.flash ? mix(to, P.glint, st.flash * .7) : mix(from, to, st.k)
  if (i === st.prev && st.k < 1) return mix(to, from, st.k)
  return from
}

/* ---------------------------------------------------------------- variants */
const VW = 66
const VARIANTS = [
  { id: 'B2', name: 'Band with a strip', from: 'VS Code list focus · Linear · Zed',
    idea: 'The same band, with a thin ▌ strip in the mode colour on its left edge, like a tab marker in an editor. Only the selected row has the strip, and it moves with the band.',
    pros: ['Reads as one shape: the strip is the band\'s edge', 'Quieter than an arrow'], cons: ['With NO_COLOR the strip is the only marker left', 'A heavy strip can look like the old rail if rows sit close'],
    keys: [['↑↓', 'choose'], ['↵', 'confirm']],
    render(Q, st) { return bandList(Q, st, (on, i, M) => [[on || (i === st.prev && st.k < 1) ? '▌' : ' ', '', fg(on ? M.c : mix(M.c, P.bg, st.k))], [' ']]) } },
  { id: 'G', name: 'Save to: search box, options in a frame', from: 'the app’s own drop zone · fzf · Raycast',
    idea: 'A frame holds the whole question: its name in the top border, a plain input line at the top, and the places below a divider. You can drag a file onto the input as well as type. Typing filters the places below it, which use the band with a strip. Dropping a file saves next to that file, and dropping a folder saves into it. Typing a path (~/ or /) works too, so "Other…" isn\'t needed.',
    pros: ['The frame makes the question one object', 'Drag the folder from Finder instead of typing it', 'The list keeps the band, so it matches every other question'], cons: ['A box and an input for what is often 4 choices', 'Typing and choosing are two modes to understand'],
    keys: [['type', 'filter'], ['↑↓', 'choose'], ['↵', 'save here']],
    render(Q, st) {
      const M = MODES[Q.mode], t = st.t
      const want = Q.rows[1].name.toLowerCase()
      let q = t < 1300 ? '' : t < 1450 ? want.slice(0, 1) : t < 2500 ? want.slice(0, 2) : ''
      if (!MOTION) q = ''
      const dropAt = 2900, dropped = Q.typePath && MOTION && t >= dropAt ? '~/Projects/site/hero.png' : null
      const rows = Q.rows.slice(0, -1)   // "Other…" is the drop zone itself
      const hits = dropped ? [] : rows.map((r, i) => i).filter(i => rows[i].name.toLowerCase().includes(q))
      const sel = q ? hits[0] : Math.min(st.idx, rows.length - 1)
      const caret = [' ', '', !MOTION || Math.floor(t / 530) % 2 === 0 ? 'background:' + P.f : '']
      const field = dropped ? [[dropped], caret] : q ? [[q, 'b'], caret] : [caret, ['type to filter, or drop a file', 'x']]
      const BW = VW, IW = BW - 4, E = fg(P.edge)
      const wrap = (l, bg) => [['│ ', '', E], ...(bg ? onBg(pad(l, IW), bg) : pad(l, IW)), [' │', '', E]]
      const count = dropped ? '' : `${hits.length}/${rows.length}`
      const top = [['╭─ ', '', E], [Q.title, 'b', fg(M.c)], [' ' + '─'.repeat(BW - 5 - Q.title.length) + '╮', '', E]]
      // a dropped path lands with a brief flash of the input line
      const flash = dropped ? fade(M.bg, P.bg, (t - dropAt) / 450) : null
      const L = [top, wrap([...pad([['› ', '', fg(M.c)], ...field], IW - 5), [count.padStart(5), 'x']], flash), [['├' + '─'.repeat(BW - 2) + '┤', '', E]]]
      if (dropped) L.push(wrap([['▌ ', '', fg(M.c)], ['Next to hero.png'.padEnd(Q.nw + 7), 'b'], ['~/Projects/site/', 'd'], ['test.jpg', 'b']], M.bg))
      hits.forEach(i => { const r = rows[i], on = i === sel, at = q ? r.name.toLowerCase().indexOf(q) : -1
        const col = fg(on ? P.f : P.n), b = on ? 'b' : ''
        const name = at < 0 ? [[r.name, b, col]] : [[r.name.slice(0, at), b, col], [r.name.slice(at, at + q.length), 'b', fg(M.c)], [r.name.slice(at + q.length), b, col]]
        // the default sits at the far end of its row, in the mode colour, whether or not it is highlighted
        const tag = r.isDefault ? [['★ default', '', fg(M.c)]] : []
        const s = [...pad([[on ? '▌ ' : '  ', '', fg(M.c)], ...pad(name, Q.nw + 4), ...(on ? detail(Q, i) : [])], IW - len(tag)), ...tag]
        L.push(wrap(s, q ? (on ? M.bg : null) : band(st, i, M)))
      })
      L.push([['╰' + '─'.repeat(BW - 2) + '╯', '', E]])
      return L
    } },
]

// the shared body of the band pickers: title with a count, then one row per choice;
// `mark` draws whatever sits at the start of the band
function bandList(Q, st, mark) {
  const M = MODES[Q.mode]
  const L = [pad(title(Q.title, M.c), VW - 5).concat([[`${st.idx + 1}/${Q.rows.length}`.padStart(5), 'x']]), []]
  Q.rows.forEach((r, i) => { const on = i === st.idx, bg = band(st, i, M)
    const s = [...mark(on, i, M), [r.name.padEnd(Q.nw + 4), on ? 'b' : '', fg(on ? P.f : P.n)], ...(on ? detail(Q, i) : [])]
    L.push(bg ? onBg(pad(s, VW), bg) : s) })
  return L
}

/* -------------------------------------------------------- other questions */
function slider(v, t, enter) {
  const n = 28, pos = Math.round(v / 100 * (n - 1)), c = MODES.convert.c, flash = flashAt(t, enter)
  return [title('Quality', c), [],
    [['━'.repeat(pos), '', fg(c)], ['●', 'b', fg(mix(c, P.glint, flash))], ['━'.repeat(n - 1 - pos), 'x'], ['  ' + v, 'b']],
    [['smaller', 'x'], [sp(n - 14)], ['sharper', 'x']]]
}
// the app's drop zone (Prompt.tsx, variant "drop"): a filled block, one cell of
// padding all round, and the marker in the accent colour
function dropZone(segs, w = VW, bg = P.sel) {
  const blank = onBg([[sp(w)]], bg)
  return [blank, onBg(pad([[' › ', '', fg(P.amber)], ...segs], w), bg), blank]
}
function nameInput(t, enter) {
  const c = MODES.convert.c, blink = !MOTION || Math.floor(t / 530) % 2 === 0
  const bg = mix(P.sel, MODES.convert.bg, flashAt(t, enter))
  return [title('Name', c), [],
    ...dropZone([['test', 'b'], ['.jpg', 'd'], [' ', '', blink ? 'background:' + P.f : '']], VW, bg),
    [], [['~/Desktop/', 'd'], ['test.jpg', 'd']]]
}
const PHASES = [['reading', 0], ['decoding', 260], ['encoding', 700], ['writing', 1500]]
function working(t) {
  let ph = 0; while (ph + 1 < PHASES.length && PHASES[ph + 1][1] <= t) ph++
  const word = PHASES[ph][0]
  return [
    [[spin(t), 'b', fg(MODES.convert.c)], [' '], ...shimmer(word[0].toUpperCase() + word.slice(1), t, P.f, MODES.convert.c, 1100), [' test.jpg', 'd'], [sp(12 - word.length)], [(t / 1000).toFixed(1) + 's', 'x']],
    [],
    [['  ']].concat(PHASES.flatMap(([w], i) => [[i ? '  ·  ' : '', 'x'], [w, '', fg(i < ph ? P.d : i === ph ? MODES.convert.c : P.ghost)]])),
  ]
}
const RW = 66, BAR = 24
function receipt(t) {
  const o = P.o, row = segs => [['│', '', fg(o)], ...pad([['  '], ...segs], RW - 2), ['│', '', fg(o)]]
  const k = ease((t - 180) / 520), filled = Math.round(Math.round(BAR * 74.6 / 122) * k)
  const lines = [
    [['╭─ ', '', fg(o)], ['✓ DONE', 'b', fg(o)], [' ' + '─'.repeat(RW - 11) + '╮', '', fg(o)]],
    row([]),
    row([['test.png', 'b'], ['  ──→  ', 'd'], ['test.jpg', 'b']]),
    row([]),
    row([['before  ', 'd'], ['█'.repeat(BAR), 'd'], ['  122 KB', 'd']]),
    row([['after   ', 'd'], ['█'.repeat(filled), '', fg(o)], ['░'.repeat(BAR - filled), 'x'], ['  74.6 KB', 'b'], ['   39% smaller', 'b', fg(fade(P.bg, o, (t - 700) / 260))]]),
    row([]),
    row([['saved to ', 'd'], ['~/Desktop/'], ['test.jpg', 'b']]),
    [['╰' + '─'.repeat(RW - 2) + '╯', '', fg(o)]],
  ]
  return lines.map((l, i) => (!MOTION || t > i * 22) ? l : [])
}

/* -------------------------------------------------------------------- logo */
const LOGO = [
  "     ║",
  "   ' ║ '",
  " *   ║   *   ███████╗ ██████╗ ██████╗  ██████╗ ███████╗",
  "   █████     ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝",
  " ▄▄▄▄▄▄▄▄▄   █████╗  ██║   ██║██████╔╝██║  ███╗█████╗",
  "▐█████████▌  ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝",
  " ▀▀▀▐█▌▀▀▀   ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗",
]
const SPARK = ["'", '*', '·', ' ', '*', "'"]
function logo(t) {
  const sweep = MOTION && t < 1300, p = ease(t / 1100) * 64 - 10
  return LOGO.map((row, r) => chars(row).map((ch, c) => {
    let col
    if (c < 13) {
      if (ch === '║') col = P.wood
      else if (ch === "'" || ch === '*') { col = P.spark; if (sweep) ch = SPARK[(Math.floor(t / 110) + c + r) % SPARK.length] }
      else if (r === 4) col = sweep ? mix(P.spark, P.heat, t / 1300) : P.heat
      else col = P.d
    } else {
      col = ch === '█' ? P.f : P.amber
      if (sweep) col = mix(col, P.glint, 1 - Math.abs(c - 13 - p - r * 1.4) / 4)
    }
    return [ch, '', fg(col)]
  }))
}

