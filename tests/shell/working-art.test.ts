import { describe, expect, it } from 'vitest'
import { SPINNER_FRAMES } from '../../src/cli/spinner.js'
import type { Job } from '../../src/core/types.js'
import { trailBarRow } from '../../src/shell/bar-art.js'
import { DARK, LIGHT, modePalette } from '../../src/shell/theme.js'
import { clockFor, pagesRow, phaseLabel, triesRow, workLine } from '../../src/shell/working-art.js'
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
/** The row under the card, two cells further left than the kit draws it (see `shifted`). */
const under = (frame: WorkFrame, row: number) => shifted(fixtureRow(frame, row))

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
    ).toBe('   Encoding AVIF')
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

  it('says the real seconds, to a tenth, from then on', () => {
    expect(clockFor(3000)).toBe('3.0s')
    expect(clockFor(3840)).toBe('3.8s')
    expect(clockFor(61_250)).toBe('61.3s')
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
    expect(row[3]).toMatchObject({ ch: '█', fg: LIGHT.track })
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
