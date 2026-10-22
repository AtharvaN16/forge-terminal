import { describe, expect, it } from 'vitest'
import { SPINNER_FRAMES } from '../../src/cli/spinner.js'
import type { Job } from '../../src/core/types.js'
import { trailBarRow } from '../../src/shell/bar-art.js'
import { mix } from '../../src/shell/home-art.js'
import { DARK, LIGHT, modePalette } from '../../src/shell/theme.js'
import {
  clockFor,
  doneLine,
  elapsed,
  nextLine,
  pagesRow,
  partsRow,
  phaseLabel,
  timeRow,
  triesRow,
  workLine,
} from '../../src/shell/working-art.js'
import {
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  runsRow,
  shifted,
} from './home-cells.js'

type WorkFrame = FixtureFrame & { t: number }
const W5 = loadFixture('working-mockup.json') as WorkFrame[]
const at = (label: string) => {
  const frame = W5.find((f) => f.label === label)
  if (!frame) throw new Error(`no W5 frame "${label}"`)
  return frame
}
/** The mockup's spinner: one frame every 80 ms since the page opened. */
const spinAt = (t: number) => SPINNER_FRAMES[Math.floor(t * 12.5) % SPINNER_FRAMES.length]
/**
 * The row under the card, one cell further left than the kit draws it (see
 * `shifted`): rows now start on the app's margin, two cells in (2026-10-20).
 */
const under = (frame: WorkFrame, row: number) => shifted(fixtureRow(frame, row), 1)

describe('the working line, against the decided W5', () => {
  it('says the phase in bold after the spinner, and no clock before 3 s', () => {
    const row = workLine({
      palette: DARK,
      mode: 'convert',
      spinner: spinAt(0.5),
      label: 'Decoding',
      clock: clockFor(500),
    })
    expect(describeRow(runsRow(row), under(at('convert at 0.5s'), 7))).toBe('equal')
  })

  it('puts the clock at the line’s right end once it has run 3 s', () => {
    const row = workLine({
      palette: DARK,
      mode: 'convert',
      spinner: spinAt(4),
      label: 'Encoding AVIF',
      clock: clockFor(4000),
    })
    expect(describeRow(runsRow(row), under(at('convert at 4s'), 7))).toBe('equal')
  })

  it('draws the spinner in the mode’s colour', () => {
    const row = workLine({
      palette: DARK,
      mode: 'pdf',
      spinner: spinAt(1),
      label: 'Splitting report.pdf',
      clock: clockFor(1000),
    })
    expect(describeRow(runsRow(row), under(at('pdf at 1s'), 7))).toBe('equal')
  })

  it('without a spinner, is the bold label alone, in the same place', () => {
    const row = workLine({ palette: DARK, mode: 'convert', label: 'Encoding AVIF' })
    expect(
      runsRow(row)
        .map((c) => c.ch)
        .join('')
        .trimEnd(),
    ).toBe('    Encoding AVIF')
  })

  it('fits a narrow terminal: the clock stays, the label gives way', () => {
    const row = workLine({
      palette: DARK,
      mode: 'convert',
      spinner: spinAt(4),
      label: 'Writing a-very-long-name-for-an-output-file.avif',
      clock: '12.3s',
      width: 40,
    })
    const text = runsRow(row, 40)
      .map((c) => c.ch)
      .join('')
    expect(text).toHaveLength(40)
    expect(text.trimEnd().endsWith('12.3s')).toBe(true)
    expect(text).toContain('…')
  })
})

describe('clockFor', () => {
  it('says nothing for the first 3 s', () => {
    expect(clockFor(0)).toBeUndefined()
    expect(clockFor(2999)).toBeUndefined()
  })

  it('says the real seconds, to a tenth, up to a minute', () => {
    expect(clockFor(3000)).toBe('3.0s')
    expect(clockFor(3840)).toBe('3.8s')
    expect(clockFor(59_940)).toBe('59.9s')
  })

  // T1, mockups/transcribe-2026-10-round3.html (2026-10-22): minutes past a minute.
  it('says minutes and seconds past a minute, and hours and minutes past an hour', () => {
    expect(clockFor(60_000)).toBe('1m 00s')
    expect(clockFor(61_250)).toBe('1m 01s')
    expect(clockFor(252_000)).toBe('4m 12s')
    expect(clockFor(3_599_999)).toBe('59m 59s')
    expect(clockFor(3_800_000)).toBe('1h 03m')
  })
})

describe('elapsed', () => {
  it('says how long a finished step took, however short, as the clock does', () => {
    expect(elapsed(1200)).toBe('1.2s')
    expect(elapsed(68_000)).toBe('1m 08s')
  })
})

/*
 * Transcribe's Working (mockups/transcribe-2026-10-round4.html, decided
 * 2026-10-22): "✓ Transcribing 1m 08s" once it is done, Writing notes faint
 * until it starts, and a two-cell square per part.
 */
describe('a finished step', () => {
  it('is a green ✓, the step in plain type, and the time it took at the clock’s place', () => {
    const cells = runsRow(doneLine({ palette: DARK, label: 'Transcribing', took: '1m 08s' }))
    const text = cells.map((c) => c.ch).join('')
    expect(text.trimEnd()).toMatch(/^ {2}✓ Transcribing +1m 08s$/)
    expect(cells[2]?.fg).toBe(DARK.ok)
    expect(cells[4]?.b).toBe(false)
    // Its clock ends where the working line's does.
    const working = runsRow(
      workLine({
        palette: DARK,
        mode: 'transcribe',
        spinner: '⠹',
        label: 'Writing notes',
        clock: '18.2s',
      }),
    )
    const end = (c: typeof cells) =>
      c
        .map((x) => x.ch)
        .join('')
        .trimEnd().length
    expect(end(cells)).toBe(end(working))
  })
})

describe('a step still to come', () => {
  it('is its name alone, faint, where the working line’s label starts', () => {
    const cells = runsRow(nextLine({ palette: DARK, label: 'Writing notes' }))
    expect(
      cells
        .map((c) => c.ch)
        .join('')
        .trimEnd(),
    ).toBe('    Writing notes')
    expect(cells[4]?.fg).toBe(DARK.faint)
  })
})

describe('the parts', () => {
  const p = modePalette(DARK, 'transcribe')
  const red = '#e63946'

  it('are a two-cell square each: written in the mode’s colour, the one being written half, the rest the track’s', () => {
    const cells = runsRow(partsRow({ palette: p, mode: 'transcribe', done: 2, of: 5 }))
    const text = cells.map((c) => c.ch).join('')
    expect(text.trimEnd()).toBe('    ██ ██ ██ ██ ██  2 of 5 parts')
    expect([4, 7, 10, 13, 16].map((i) => cells[i]?.fg)).toEqual([
      red,
      red,
      mix(red, p.canvas, 0.55),
      p.track,
      p.track,
    ])
  })

  it('never draws more squares than parts, or a part past the last', () => {
    const text = (done: number, of: number) =>
      runsRow(partsRow({ palette: p, mode: 'transcribe', done, of }))
        .map((c) => c.ch)
        .join('')
        .trimEnd()
    expect(text(9, 3)).toBe('    ██ ██ ██  3 of 3 parts')
    expect(text(-1, 2)).toBe('    ██ ██  0 of 2 parts')
    expect(text(0, 1)).toBe('    ██  0 of 1 part')
  })
})

describe('the size search’s dots, against the decided W5', () => {
  it('one filled dot per try done, one faint dot per try left', () => {
    expect(
      describeRow(
        runsRow(triesRow({ palette: DARK, mode: 'compress', n: 3, of: 8 })),
        under(at('compress at 1.3s'), 9),
      ),
    ).toBe('equal')
  })

  it('never draws more dots than the bound, or a negative count', () => {
    const text = (n: number, of: number) =>
      runsRow(triesRow({ palette: DARK, mode: 'compress', n, of }))
        .map((c) => c.ch)
        .join('')
        .trim()
    expect(text(8, 8)).toBe('● ● ● ● ● ● ● ●')
    expect(text(9, 8)).toBe('● ● ● ● ● ● ● ●')
    expect(text(0, 3)).toBe('○ ○ ○')
  })
})

describe('the page bar, against the decided W5', () => {
  it('fills to the share of pages done, with no knob', () => {
    expect(
      describeRow(
        runsRow(pagesRow({ palette: DARK, mode: 'pdf', done: 3, total: 12 })),
        under(at('pdf at 1s'), 9),
      ),
    ).toBe('equal')
  })

  it('is full on the last page', () => {
    expect(
      describeRow(
        runsRow(pagesRow({ palette: DARK, mode: 'pdf', done: 12, total: 12 })),
        under(at('pdf at 3.9s'), 9),
      ),
    ).toBe('equal')
  })

  it('draws the rest of the track in the theme’s track colour, in light too', () => {
    const row = runsRow(pagesRow({ palette: LIGHT, mode: 'pdf', done: 0, total: 4 }))
    expect(row[4]).toMatchObject({ ch: '█', fg: LIGHT.track })
  })

  it('counts files, a folder’s, in their own word', () => {
    const row = pagesRow({ palette: DARK, mode: 'convert', done: 9, total: 24, unit: 'images' })
    expect(row.at(-1)?.text).toBe('  9 of 24 images')
  })

  it('says how far it is in other words when given them: a length heard, bytes fetched', () => {
    const row = pagesRow({
      palette: DARK,
      mode: 'transcribe',
      done: 1390,
      total: 3717,
      says: '23:10 of 1:01:57',
    })
    expect(row.at(-1)?.text).toBe('  23:10 of 1:01:57')
    expect(row[1]?.text).toBe('█'.repeat(11))
  })
})

describe('the bar drifts while working', () => {
  const answers = {
    convert: ['AVIF', '60', 'Desktop', 'photo.avif'],
    pdf: ['Split', 'every page', 'Desktop'],
  }
  for (const [label, mode, verb] of [
    ['convert at 0.5s', 'convert', 'Converting'],
    ['convert at 4s', 'convert', 'Converting'],
    ['pdf at 1s', 'pdf', 'Splitting'],
  ] as const) {
    it(`matches the mockup’s hatching, ${label}`, () => {
      const frame = at(label)
      const row = trailBarRow({
        width: 80,
        palette: modePalette(DARK, mode),
        mode,
        trail: { answers: answers[mode], current: verb },
        slanted: true,
        drift: frame.t,
      })
      expect(describeRow(runsRow(row), fixtureRow(frame, 0))).toBe('equal')
    })
  }

  it('leaves the chip and the trail where they were', () => {
    const still = trailBarRow({
      width: 80,
      palette: DARK,
      mode: 'convert',
      trail: { answers: ['JPEG'], current: 'Converting' },
      slanted: true,
    })
    const moving = trailBarRow({
      width: 80,
      palette: DARK,
      mode: 'convert',
      trail: { answers: ['JPEG'], current: 'Converting' },
      slanted: true,
      drift: 1.7,
    })
    const text = (row: typeof still) =>
      runsRow(row)
        .map((c) => c.ch)
        .join('')
    expect(text(moving)).toBe(text(still))
    expect(runsRow(moving).filter((c) => c.ch !== '╱')).toEqual(
      runsRow(still).filter((c) => c.ch !== '╱'),
    )
  })
})

describe('phaseLabel: the phase as the line says it', () => {
  const source = {
    kind: 'image' as const,
    path: '/Users/me/photo.heic',
    format: 'heic' as const,
    width: 4032,
    height: 3024,
    bytes: 2_400_000,
    hasAlpha: false,
    frames: 1,
  }
  const job: Extract<Job, { op: 'convert' }> = {
    op: 'convert',
    sources: [source],
    outputs: ['/Users/me/Desktop/photo.avif'],
    target: 'avif',
    options: { background: '#ffffff', keepMetadata: false },
  }

  it('names the format it encodes to, from the job', () => {
    expect(phaseLabel(job, 'reading')).toBe('Reading')
    expect(phaseLabel(job, 'decoding')).toBe('Decoding')
    expect(phaseLabel(job, 'encoding')).toBe('Encoding AVIF')
    expect(phaseLabel({ ...job, target: 'webp' }, 'encoding')).toBe('Encoding WebP')
  })

  it('names the file it writes, or how many', () => {
    expect(phaseLabel(job, 'writing')).toBe('Writing photo.avif')
    expect(phaseLabel({ ...job, outputs: ['/a/1.jpg', '/a/2.jpg', '/a/3.jpg'] }, 'writing')).toBe(
      'Writing 3 files',
    )
  })
})

describe('the time bar, for video and sound', () => {
  const text = (row: ReturnType<typeof timeRow>) => row.map((r) => r.text).join('')

  it('fills to the seconds encoded of the seconds there will be, as the page bar does', () => {
    const row = timeRow({ palette: DARK, mode: 'convert', done: 14, total: 38, elapsedMs: 2000 })
    const bar = pagesRow({ palette: DARK, mode: 'convert', done: 14, total: 38 })
    expect(row.slice(0, 3)).toEqual(bar.slice(0, 3))
    expect(text(row)).toContain('0:14 of 0:38')
  })

  it('says the time left only after 5 s, from the speed measured', () => {
    expect(
      text(timeRow({ palette: DARK, mode: 'convert', done: 10, total: 40, elapsedMs: 4000 })),
    ).not.toContain('left')
    expect(
      text(timeRow({ palette: DARK, mode: 'convert', done: 10, total: 40, elapsedMs: 5000 })),
    ).toContain('about 15 s left')
  })

  it('says minutes once it is a minute or more', () => {
    expect(
      text(timeRow({ palette: DARK, mode: 'convert', done: 10, total: 200, elapsedMs: 10_000 })),
    ).toContain('about 3 min left')
  })
})
