/**
 * The drop zone once files are staged, cell for cell against the frozen
 * mockup (mockups/drop-zone-2026-10.html → fixtures/drop-mockup.json).
 */
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Home, homeKeys } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import type { StagedFile, StagedView, UnderField } from '../../src/shell/stage.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { ansiRow, describeHomeRow, type FixtureFrame, homeRow, loadFixture } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const [one, three, many] = loadFixture('drop-mockup.json') as [
  FixtureFrame,
  FixtureFrame,
  FixtureFrame,
]

const heic = (n: number, size: string): StagedFile => ({
  name: `IMG_410${n}.HEIC`,
  tag: 'HEIC',
  size,
  facts: '',
})
const photo: StagedFile = {
  name: 'photo.png',
  tag: 'PNG',
  size: '122 KB',
  facts: '2756×774 · 122 KB · transparent',
}
const THREE = [heic(1, '2.1 MB'), heic(2, '1.9 MB'), heic(3, '2.4 MB')]
const MANY = [
  ...THREE,
  heic(4, '2.2 MB'),
  heic(5, '2.0 MB'),
  { name: 'Screenshot 2026-10-09 at 14.02.11.png', tag: 'PNG', size: '840 KB', facts: '' },
  photo,
  { name: 'report.pdf', tag: 'PDF', size: '1.4 MB', facts: '' },
]

function screen(staged: StagedView, under?: UnderField, verb: string | null = 'convert') {
  const mode = 'convert'
  return render(
    <ThemeProvider palette={modePalette(DARK, mode)}>
      <Home
        width={80}
        height={24}
        mode={mode}
        typing={false}
        savesTo="~/Desktop"
        field={
          <Prompt
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            placeholder="drop more, or type a path"
            isActive
            variant="home"
            width={80}
          />
        }
        staged={staged}
        under={under}
        keys={homeKeys({
          typing: false,
          completions: 0,
          commands: false,
          staged: { count: staged.files.length, verb },
        })}
      />
    </ThemeProvider>,
  )
}

function expectRows(frame: FixtureFrame, lines: string[], rows: number[]) {
  expect(lines).toHaveLength(24)
  for (const row of rows) {
    const actual = ansiRow(lines[row] ?? '')
    expect(describeHomeRow(actual, homeRow(frame, row)), `${frame.label}, row ${row}`).toBe('equal')
  }
}

const UP_TO_FIELD = Array.from({ length: 17 }, (_, i) => i)

describe('the staged drop zone, against the mockup (80 × 24)', () => {
  it('one file is a card on the dimmed dots, with the key row for ↵', () => {
    const lines = (
      screen({ files: [photo], headline: '1 image', total: '122 KB', fresh: 0 }).lastFrame() ?? ''
    ).split('\n')
    expectRows(one, lines, UP_TO_FIELD)
    // The mockup's key row predates ←→ for the modes (2026-10-13).
    const keys = ansiRow(lines[23] ?? '')
      .map((c) => c.ch)
      .join('')
    expect(keys).toMatch(/↵ +convert/)
    expect(keys).toMatch(/1–5 ←→ +mode/)
  })

  it('three files are a list under their headline', () => {
    const lines = (
      screen({ files: THREE, headline: '3 images', total: '6.4 MB', fresh: 0 }).lastFrame() ?? ''
    ).split('\n')
    expectRows(three, lines, UP_TO_FIELD)
  })

  it('eight files are three rows and "+5 more", with the red left-out row under the field', () => {
    const lines = (
      screen(
        { files: MANY, headline: '8 files', total: '13.2 MB', fresh: 0 },
        {
          kind: 'left-out',
          count: 1,
          name: 'archive.zip',
          reason: 'unsupported file type',
          more: 0,
        },
        null,
      ).lastFrame() ?? ''
    ).split('\n')
    expectRows(many, lines, [...UP_TO_FIELD, 18])
  })
})
