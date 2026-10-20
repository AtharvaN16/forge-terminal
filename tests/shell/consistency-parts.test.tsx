import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import stringWidth from 'string-width'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HintBar } from '../../src/shell/components/HintBar.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { Select } from '../../src/shell/components/Select.js'
import { StepTitle } from '../../src/shell/components/StepTitle.js'
import { HOME_MARGIN } from '../../src/shell/home-art.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, type Palette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})
afterEach(() => {
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const bgOf = (hex: string) =>
  `48;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}`
const fgOf = (hex: string) =>
  `38;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}`
const convert = modePalette(DARK, 'convert')
const frame = (node: ReactElement, palette: Palette = convert) =>
  render(<ThemeProvider palette={palette}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('the picker band', () => {
  const items = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'webp', label: 'WebP' },
  ]

  it('is grey, as the decided picker draws it, not the mode’s tint', () => {
    const out = frame(<Select width={52} items={items} onSubmit={() => {}} />)
    const row = out.split('\n')[0] ?? ''
    expect(row).toContain(bgOf(DARK.listBand))
    expect(row).not.toContain(bgOf(DARK.modeConvertBg))
  })

  it('keeps the strip in the mode’s colour', () => {
    const row = frame(<Select width={52} items={items} onSubmit={() => {}} />).split('\n')[0] ?? ''
    expect(row).toContain(`${fgOf(DARK.modeConvert)}m▌`)
  })
})

describe('a default, in a list', () => {
  const items = [
    { value: '72', label: '72 dpi' },
    { value: '150', label: '150 dpi', badge: 'default' },
  ]

  it('is P1’s tinted tag at the far end of its row, with no star', () => {
    const out = frame(<Select width={52} items={items} onSubmit={() => {}} />)
    const row = out.split('\n')[1] ?? ''
    expect(plain(row)).toMatch(/^ {2}150 dpi +default \s*$/)
    expect(row).toContain(bgOf(DARK.defaultTagBg))
    expect(row).toContain(fgOf(DARK.defaultTag))
    expect(out).not.toContain('★')
  })

  it('is the bare word without colour', () => {
    process.env.NO_COLOR = '1'
    const row = plain(frame(<Select width={52} items={items} onSubmit={() => {}} />).split('\n')[1])
    expect(row).toMatch(/150 dpi +default/)
    expect(row).not.toContain('★')
  })
})

describe('StepTitle', () => {
  it('is the question in bold, in the mode’s colour, what it is about quiet at its right', () => {
    const out = frame(
      <StepTitle mode="convert" title="Pages" aside="report.pdf · 3 pages" width={80} />,
    )
    expect(plain(out)).toMatch(/^ Pages +report\.pdf · 3 pages$/)
    expect(out).toContain(fgOf(DARK.modeConvert))
    expect(out).toContain(`${ESC}[1m`)
  })
})

describe('HintBar, always F1', () => {
  const keys = (out: string) => plain(out).split('\n').at(-1) ?? ''

  it('keeps the divider across the terminal above the keys', () => {
    const out = plain(frame(<HintBar width={60} pairs={[['↵', 'confirm']]} />))
    expect(out.split('\n')).toContain('─'.repeat(60))
  })

  it('moves mode, esc and quit to the quiet footnote, and adds quit where it was left out', () => {
    const out = frame(
      <HintBar
        width={80}
        pairs={[
          ['↑↓', 'choose'],
          ['↵', 'confirm'],
          ['1–4', 'mode'],
          ['esc', 'back'],
        ]}
      />,
    )
    expect(keys(out)).toMatch(
      /^ {3}↑↓ {2}choose {3}↵ {2}confirm +1–4 mode · esc back · ctrl-c quit$/,
    )
  })

  it('lines the keys up with the content: the first cap on the margin, the footnote ending on it', () => {
    const out = frame(<HintBar width={80} pairs={[['↵', 'confirm']]} />)
    const row = keys(out)
    // The cap's fill starts on the margin (column 2); its key a cell in.
    expect(row.indexOf('↵')).toBe(HOME_MARGIN + 1)
    // The footnote's last letter is on the block's last column, 77.
    expect(row.trimEnd().length).toBe(80 - HOME_MARGIN)
  })

  it('says quit, never "close app"', () => {
    const out = frame(
      <HintBar width={80} pairs={[['↵', 'send']]} foot={[['ctrl-c', 'close app']]} />,
    )
    expect(keys(out)).toMatch(/ctrl-c quit$/)
  })
})

describe('the filled field', () => {
  const field = (width: number) =>
    plain(
      frame(
        <Prompt
          value="2"
          onChange={() => {}}
          onSubmit={() => {}}
          placeholder=""
          isActive
          variant="field"
          width={width}
        />,
      ),
    )
      .split('\n')
      .filter((l) => l !== '')

  it('is the block’s width, as Save as’s is: 76 at 80 columns, never the terminal’s', () => {
    for (const [width, want] of [
      [80, 76],
      [120, 76],
      [50, 46],
    ] as const) {
      const rows = field(width)
      for (const row of rows) expect(stringWidth(row)).toBe(want)
    }
  })
})
