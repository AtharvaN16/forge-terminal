/**
 * The Done screen, round thirteen (2026-10-19). Round twelve's verdicts
 * (mockups/feedback/done-round6.json): no likes; potential for 1 today,
 * 2 as decided, 7 pinned under the header and 10 the change between the
 * sizes; the rest disliked or hated. So the name stays in the bar, the bar
 * keeps the block's width, the sizes keep their own row under it, and the
 * result never sits low.
 *
 * This round crosses the four "potential" ones along what still differs
 * between them: where the result sits (middle or top), where the change
 * goes (in the bar, on the chip's row, between the sizes), where p goes
 * (beside the chip, bottom left, under the result), and the bar's height.
 *
 *   npx tsx scripts/done-mockup-r7.ts   → mockups/done-2026-10-round7.html
 */
import { writeFileSync } from 'node:fs'
import { doneBody } from '../src/shell/done-art.js'
import { blank, type Row } from '../src/shell/home-art.js'
import { DARK, modePalette, type Palette } from '../src/shell/theme.js'
import {
  bar,
  bothBottom,
  chip,
  chipAndPreset,
  F,
  more,
  moreBottom,
  N,
  pill,
  preset,
  screen,
  sizes,
  sizesWithChange,
  spread,
} from './done-pieces.js'
import { feedbackPage } from './feedback-page.js'
import { termHtml, toGrid } from './term-cells.js'

interface Concept {
  id: string
  name: string
  idea: string
  draw: (p: Palette) => Row[]
}

/** Today's body as the app draws it, p beside the chip. */
const today = (p: Palette): Row[] => {
  const body = doneBody({ palette: p, facts: F, width: N })
  body[0] = [...(body[0] ?? []), blank(1), ...preset(p)]
  return body
}
/** Today's arrangement with the five-row bar: the change still in it. */
const todayTall = (p: Palette): Row[] => [
  spread(chipAndPreset(p)),
  ...bar(p, { change: true }),
  [],
  sizes(p),
]

const CONCEPTS: Concept[] = [
  {
    id: '11',
    name: '7 and 10 together',
    idea: 'Pinned under the header (7), with 10’s rows: the chip’s row is the chip and p, the change sits between now and was. → at the bottom right.',
    draw: (p) =>
      screen(
        p,
        [spread([chip(p)], [...preset(p)]), [], ...bar(p), [], sizesWithChange(p)],
        moreBottom(p),
        'top',
      ),
  },
  {
    id: '12',
    name: '7 with a three-row bar',
    idea: '7 exactly, but the bar is today’s height, three rows, so the whole result is smaller and the keys come sooner.',
    draw: (p) =>
      screen(
        p,
        [
          spread([chip(p)], [pill(p)]),
          [],
          ...bar(p, { rows: 3 }),
          [],
          sizes(p),
          [],
          spread(preset(p), more(p)),
        ],
        undefined,
        'top',
      ),
  },
  {
    id: '13',
    name: 'Today, pinned under the header',
    idea: 'Today’s screen untouched, moved up: the chip and p, the three-row bar with the name and the change in it, now and was; → at the bottom right.',
    draw: (p) => screen(p, today(p), moreBottom(p), 'top'),
  },
  {
    id: '14',
    name: 'Today, tall',
    idea: 'Today’s screen where it is, in the middle, with the bar five rows tall; the change stays in the bar, on the name’s row.',
    draw: (p) => screen(p, todayTall(p), moreBottom(p)),
  },
  {
    id: '15',
    name: 'Today, tall and pinned',
    idea: '14 moved up under the header: today’s pieces, the tall bar, the result at the top.',
    draw: (p) => screen(p, todayTall(p), moreBottom(p), 'top'),
  },
  {
    id: '16',
    name: '10 with p at the bottom left',
    idea: '10 in the middle, but the chip’s row is the chip alone and p joins → on the bottom row, one at each end. The change between now and was.',
    draw: (p) =>
      screen(p, [spread([chip(p)]), [], ...bar(p), [], sizesWithChange(p)], bothBottom(p)),
  },
  {
    id: '17',
    name: '2 with p beside the chip',
    idea: '2 in the middle, but p goes back beside the chip as built: chip, p, and the change at the row’s far end. → alone at the bottom right.',
    draw: (p) =>
      screen(p, [spread(chipAndPreset(p), [pill(p)]), [], ...bar(p), [], sizes(p)], moreBottom(p)),
  },
  {
    id: '18',
    name: '7 with the change between the sizes',
    idea: '7 pinned under the header with p and → under the result, but the chip’s row is the chip alone and the change moves between now and was, as in 10.',
    draw: (p) =>
      screen(
        p,
        [spread([chip(p)]), [], ...bar(p), [], sizesWithChange(p), [], spread(preset(p), more(p))],
        undefined,
        'top',
      ),
  },
]

const p = modePalette(DARK, 'convert')
const html = feedbackPage({
  page: 'done-round7',
  title: 'Forge · Done, round thirteen',
  heading: 'Done, the four with potential, crossed',
  lede: 'Last round you gave no likes and four “potential”: 1 today, 2 as decided, 7 pinned under the header, 10 the change between the sizes. These eight cross them. Fixed now, from what you hated: the name stays in the bar, the bar keeps its full width, the sizes keep their own row, and the result never sits low. Dark, 80 × 24.',
  before: `<div class="box"><h3>What still differs</h3><ul>
<li><b>Where the result sits:</b> the middle (14, 16, 17) or right under the header (11, 12, 13, 15, 18).</li>
<li><b>Where the change goes:</b> in the bar (13, 14, 15), at the chip row’s end (12, 17), or between now and was (11, 16, 18).</li>
<li><b>Where p goes:</b> beside the chip (13, 14, 15, 17), at the chip row’s end (11), at the bottom left (16), or under the result with → (12, 18).</li>
<li><b>The bar’s height:</b> three rows (12, 13) or five (the rest).</li></ul></div>`,
  concepts: CONCEPTS.map((c) => ({
    id: c.id,
    name: c.name,
    idea: c.idea,
    html: termHtml(p, toGrid(c.draw(p), N)),
  })),
})
writeFileSync('mockups/done-2026-10-round7.html', html)
console.log('wrote mockups/done-2026-10-round7.html')
