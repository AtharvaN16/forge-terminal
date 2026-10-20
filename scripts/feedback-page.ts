/**
 * A mockup page whose concepts each carry verdict buttons (memory: verdict
 * buttons, 2026-10-19): "I like it", "Not now, but it has potential",
 * "I don't like it", "I completely hate this", an optional line on why, and
 * one "I would like more concepts" button at the top.
 *
 * Served by scripts/mockup-feedback-server.mjs, every change is saved to
 * mockups/feedback/<page>.json for the design session to read; opened as a
 * file, the answers stay in the browser and "Copy my answers" copies them.
 */
import { TERM_CSS } from './term-cells.js'

export interface PageConcept {
  id: string
  name: string
  idea: string
  /** The figure: one or more terminals, side by side. */
  html: string
  /** A heading (HTML) to open a new section before this concept. */
  section?: string
  /** What the user said about this one in an earlier round: shown as a badge. */
  earlier?: 'love' | 'like' | 'potential' | undefined
  /**
   * Opens a new tab, named so, holding this concept and the ones after it up
   * to the next `tab`. A page with no tabs is drawn as before.
   */
  tab?: string
}

const BADGES = { love: 'Liked a lot', like: 'Liked', potential: 'Potential' } as const

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const VERDICTS = [
  ['love', 'I like it a lot'],
  ['like', 'I like it'],
  ['potential', 'Not now, but it has potential'],
  ['dislike', 'I don’t like it'],
  ['hate', 'I completely hate this'],
] as const

/** The tabs' look, only on a page that has them. */
const TAB_CSS = `
  .tabs { display:flex; gap:6px; flex-wrap:wrap; margin:28px 0 0; padding-bottom:12px; border-bottom:1px solid #23252c; position:sticky; top:0; background:#0d0e11; z-index:2; padding-top:10px; } .tab .n { color:#8f94a1; font-weight:500; margin-left:6px; } .tab.on { background:#12282e; border-color:#55c7d9; color:#8fe3f0; } .pane { display:none; } .pane.on { display:block; } .pane > .concept:first-child { margin-top:28px; }`

/** Showing one tab's pane, kept in the URL's hash; each tab counts its answers. */
const TAB_JS = `const tabButtons = [...document.querySelectorAll('.tab')]
function showTab(i) {
  tabButtons.forEach((b) => b.classList.toggle('on', b.dataset.tab === String(i)))
  for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.dataset.pane === String(i))
  history.replaceState(null, '', '#tab' + i)
}
function countTabs() {
  for (const b of tabButtons) {
    const pane = document.querySelector('.pane[data-pane="' + b.dataset.tab + '"]')
    const all = pane.querySelectorAll('.concept')
    const done = [...all].filter((s) => state.verdicts[s.dataset.id]).length
    let n = b.querySelector('.n')
    if (!n) { n = document.createElement('span'); n.className = 'n'; b.append(n) }
    n.textContent = done + '/' + all.length
  }
}
for (const b of tabButtons) b.addEventListener('click', () => showTab(b.dataset.tab))
if (tabButtons.length) showTab(Number((location.hash.match(/^#tab([0-9]+)$/) || [])[1] || 0))
`

export function feedbackPage({
  page,
  title,
  heading,
  lede,
  before = '',
  concepts,
  compact = false,
}: {
  /** The answers' file name: mockups/feedback/<page>.json. */
  page: string
  title: string
  heading: string
  /** HTML. */
  lede: string
  /** HTML between the top buttons and the first concept. */
  before?: string
  concepts: PageConcept[]
  /** Short figures: the buttons two by two, the concepts closer together. */
  compact?: boolean
}): string {
  const tabbed = concepts.some((c) => c.tab !== undefined)
  const tabs = tabbed
    ? `<nav class="tabs">${concepts
        .filter((c) => c.tab !== undefined)
        .map((c, i) => `<button class="tab" data-tab="${i}">${esc(c.tab ?? '')}</button>`)
        .join('')}</nav>`
    : ''
  let opened = -1
  const figures = concepts
    .map((c) => {
      const open =
        c.tab !== undefined
          ? `${opened >= 0 ? '</div>' : ''}<div class="pane" data-pane="${++opened}">`
          : ''
      return `${open}${c.section ? `<h2>${c.section}</h2>` : ''}<section class="concept${c.earlier === 'like' || c.earlier === 'love' ? ' earlier-like' : ''}" data-id="${esc(c.id)}">
  <div class="figure">${c.html}</div>
  <div class="side">
    <div class="vt"><span class="id">${esc(c.id)}</span><span class="name">${esc(c.name)}</span>${c.earlier ? `<span class="badge ${c.earlier}">${BADGES[c.earlier]}</span>` : ''}</div>
    <p class="idea">${esc(c.idea)}</p>
    <div class="verdicts">${VERDICTS.map(([v, label]) => `<button data-v="${v}">${label}</button>`).join('')}</div>
    <textarea class="why" rows="2" placeholder="Why? (optional)"></textarea>
  </div>
</section>`
    })
    .join('')
    .concat(tabbed ? '</div>' : '')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  h2 { font-size:22px; margin:64px 0 0; padding-top:20px; border-top:1px solid #23252c; }
  h2 + .concept { margin-top:24px; }
  ${compact ? `.concept { margin-top:30px !important; } .verdicts { display:grid !important; grid-template-columns:1fr 1fr; } .verdicts button[data-v="love"] { grid-column:1 / -1; } .verdicts button { font-size:13px; padding:7px 10px; } .idea { margin-bottom:12px !important; }` : ''}
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1500px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; }
  .lede { color:#8f94a1; max-width:1000px; margin:0; }
  .box { border:1px solid #2c2f37; border-radius:10px; padding:14px 18px; margin:22px 0 0; max-width:1000px; background:#14161b; }
  .box h3 { margin:0 0 6px; font-size:14px; letter-spacing:.06em; text-transform:uppercase; color:#8f94a1; }
  .box ul, .box ol { margin:6px 0 0 20px; padding:0; } .box li { margin:4px 0; }
  .top { display:flex; align-items:center; gap:16px; margin:24px 0 8px; flex-wrap:wrap; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; }
  .concept { display:flex; gap:32px; align-items:flex-start; margin:44px 0 0; }
  .figure { display:flex; gap:24px; flex:none; }
  .side { max-width:420px; padding-top:4px; }
  .vt { display:flex; align-items:baseline; gap:10px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 8px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; font-size:18px; }
  .badge { font:700 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing:.06em; text-transform:uppercase; padding:3px 8px; border-radius:6px; align-self:center; }
  .badge.love { background:#1d4a2a; color:#b6f5c6; border:1px solid #5fc27a; }
  .badge.like { background:#16301d; color:#8fe0a3; border:1px solid #3f8f55; }
  .badge.potential { background:#2a2414; color:#d9bb6a; border:1px solid #6e5a26; }
  .concept.earlier-like { padding:14px; margin-left:-14px; border-radius:12px; background:#101a13; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 18px; }
  .verdicts { display:flex; flex-direction:column; gap:8px; }
  button { font:600 14px -apple-system, BlinkMacSystemFont, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:9px 14px; text-align:left; cursor:pointer; transition:background .12s, border-color .12s, color .12s; }
  button:hover { border-color:#4a4f5a; color:#fff; }
  button[data-v="love"].on { background:#1d4a2a; border-color:#5fc27a; color:#b6f5c6; }
  button[data-v="like"].on { background:#16301d; border-color:#3f8f55; color:#8fe0a3; }
  button[data-v="potential"].on { background:#2e2614; border-color:#9a7a2c; color:#f0cf7a; }
  button[data-v="dislike"].on { background:#24262c; border-color:#6b7080; color:#e2e4ea; }
  button[data-v="hate"].on { background:#341618; border-color:#a8414a; color:#ff9aa2; }
  button.more { padding:11px 18px; font-size:15px; }
  button.more.on { background:#12282e; border-color:#55c7d9; color:#8fe3f0; }
  button.copy { font-weight:500; }
  .why { width:100%; box-sizing:border-box; margin-top:10px; font:14px -apple-system, BlinkMacSystemFont, sans-serif; color:#e2e4ea; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 12px; resize:vertical; }
  .why:focus { outline:none; border-color:#4a4f5a; }
  code { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#c7cbd4; }${tabbed ? TAB_CSS : ''}
  ${TERM_CSS}
</style></head><body><main>
<h1>${esc(heading)}</h1>
<p class="lede">${lede}</p>
<div class="top">
  <button class="more">I would like more concepts</button>
  <button class="copy">Copy my answers</button>
  <span class="status"></span>
</div>
${before}
${tabs}${figures}
<script>
const PAGE = ${JSON.stringify(page)}
const status = document.querySelector('.status')
const served = location.protocol.startsWith('http')
let state = JSON.parse(localStorage.getItem(PAGE) || 'null') || { verdicts: {}, notes: {}, moreConcepts: false }
state.notes ??= {}

function paint() {
  for (const s of document.querySelectorAll('.concept')) {
    const id = s.dataset.id
    for (const b of s.querySelectorAll('button')) b.classList.toggle('on', state.verdicts[id] === b.dataset.v)
    const why = s.querySelector('.why')
    if (document.activeElement !== why) why.value = state.notes[id] || ''
  }
  document.querySelector('.more').classList.toggle('on', !!state.moreConcepts)
${tabbed ? '  countTabs()\n' : ''}}
function summary() {
  const lines = [...document.querySelectorAll('.concept')].map((s) => {
    const id = s.dataset.id
    const note = state.notes[id] ? ' (' + state.notes[id] + ')' : ''
    return id + ' ' + s.querySelector('.name').textContent + ': ' + (state.verdicts[id] || '—') + note
  })
  return PAGE + '\\n' + lines.join('\\n') + '\\nMore concepts: ' + (state.moreConcepts ? 'yes' : 'no')
}
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(state))
  paint()
  if (!served) { status.textContent = 'kept in this browser · use Copy my answers'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, ...state }) })
    status.textContent = r.ok ? 'saved for Claude · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my answers'
  } catch { status.textContent = 'not saved · use Copy my answers' }
}
let typing
for (const s of document.querySelectorAll('.concept')) {
  const id = s.dataset.id
  for (const b of s.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      state.verdicts[id] = state.verdicts[id] === b.dataset.v ? undefined : b.dataset.v
      save()
    })
  }
  s.querySelector('.why').addEventListener('input', (e) => {
    state.notes[id] = e.target.value.trim() || undefined
    clearTimeout(typing)
    typing = setTimeout(save, 500)
  })
}
${tabbed ? TAB_JS : ''}document.querySelector('.more').addEventListener('click', () => { state.moreConcepts = !state.moreConcepts; save() })
document.querySelector('.copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(summary())
  status.textContent = 'copied · paste it to Claude'
})
if (served) {
  fetch('/feedback/' + PAGE).then((r) => r.json()).then((saved) => {
    if (saved && saved.verdicts) state = { verdicts: saved.verdicts, notes: saved.notes || {}, moreConcepts: !!saved.moreConcepts }
    paint()
  }).catch(paint)
} else paint()
</script>
</main></body></html>`
}
