import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import stringWidth from 'string-width'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PathPreset } from '../../src/core/actions/index.js'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { SaveAs } from '../../src/shell/components/SaveAs.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'
import {
  ansiRow,
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  shifted,
} from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const ENTER = '\r'
const TAB = '\t'
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => (f ?? '').split('\n')

const P1 = loadFixture('save-as-mockup.json') as FixtureFrame[]
const frame = (label: string) => P1.find((f) => f.label === label) as FixtureFrame

/** The mockup's folders, made real in a temp root shown as `~`. */
let root = ''
let presets: PathPreset[] = []
const display = (p: string) => p.replace(root, '~')
beforeAll(async () => {
  root = await makeTempDir()
  for (const d of ['Pictures', 'Desktop', 'Downloads', 'Documents']) await mkdir(join(root, d))
  presets = [
    { label: 'Same folder', path: join(root, 'Pictures') },
    { label: 'Desktop', path: join(root, 'Desktop') },
    { label: 'Downloads', path: join(root, 'Downloads') },
    { label: 'Documents', path: join(root, 'Documents') },
    // Not made: a folder the save would create.
    { label: 'New folder…', path: join(root, 'new') },
  ]
})

type Props = ComponentProps<typeof SaveAs>

/** Save as with the name and folder held the way App holds them. */
function Harness(over: Partial<Props> & { initialName?: string }) {
  const [name, setName] = useState(over.initialName ?? 'header')
  const [folder, setFolder] = useState(over.folder ?? join(root, 'Desktop'))
  const [defaultPath, setDefault] = useState(over.defaultPath ?? join(root, 'Desktop'))
  return (
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <SaveAs
        mode="convert"
        width={80}
        name={name}
        onNameChange={setName}
        proposed="test"
        ext=".jpg"
        presets={presets}
        display={display}
        onSubmit={() => {}}
        onBack={() => {}}
        {...over}
        folder={folder}
        onFolder={(p) => {
          setFolder(p)
          over.onFolder?.(p)
        }}
        defaultPath={defaultPath}
        onMakeDefault={(p) => {
          setDefault(p)
          over.onMakeDefault?.(p)
        }}
      />
    </ThemeProvider>
  )
}

/** Rows `from`…`to` of a frame against the mockup's, from its row `at`. */
function sameRows(out: string | undefined, f: FixtureFrame, from: number, to: number, at: number) {
  const ls = lines(out)
  for (let i = from; i <= to; i++) {
    const got = describeRow(ansiRow(ls[i] ?? ''), shifted(fixtureRow(f, at + i - from)))
    if (got !== 'equal') return `row ${i}: ${got}`
  }
  return 'equal'
}

describe('Save as against P1', () => {
  it('titles the question, then holds the sentence in the filled field', () => {
    const { lastFrame } = render(<Harness />)
    const f = frame('name, header')
    expect(sameRows(lastFrame(), f, 0, 0, 7)).toBe('equal')
    // The title, two blank rows, then the field: padding, sentence, padding.
    expect(sameRows(lastFrame(), f, 1, 5, 8)).toBe('equal')
  })

  it('opens the field downward on tab, the list inside it, Desktop highlighted and tagged', async () => {
    const { stdin, lastFrame } = render(<Harness />)
    stdin.write(TAB)
    await settle()
    expect(sameRows(lastFrame(), frame('folder, Desktop'), 3, 11, 10)).toBe('equal')
  })

  it('moves the highlight with ↓, and the pill follows it', async () => {
    const { stdin, lastFrame } = render(<Harness />)
    stdin.write(TAB)
    await settle()
    stdin.write(DOWN)
    await settle()
    expect(sameRows(lastFrame(), frame('folder, Downloads'), 3, 11, 10)).toBe('equal')
  })

  it('moves the tag the moment tab makes the highlighted folder the default', async () => {
    const onMakeDefault = vi.fn()
    const { stdin, lastFrame } = render(<Harness onMakeDefault={onMakeDefault} />)
    stdin.write(TAB)
    await settle()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).toHaveBeenCalledWith(join(root, 'Downloads'))
    expect(sameRows(lastFrame(), frame('folder, Downloads made default'), 3, 11, 10)).toBe('equal')
  })
})

describe('Save as, the title', () => {
  it('says what the job will do at the title’s right, quietly', () => {
    const out = plain(render(<Harness aside="Rotate 90°" />).lastFrame())
    expect(out.split('\n')[0]).toMatch(/^ Save as +Rotate 90°$/)
  })
})

describe('Save as, the name', () => {
  it('offers save and folder, with back and quit as the footnote', () => {
    const keys =
      plain(render(<Harness />).lastFrame())
        .trimEnd()
        .split('\n')
        .at(-1) ?? ''
    expect(keys).toMatch(/^ {2}↵ {2}save {3}tab {2}folder +esc back · ctrl-c quit$/)
  })

  it('saves with the name and folder on ↵', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write('-2')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Desktop'), 'header-2')
  })

  it('clears the name on the first esc, and goes back on the second', async () => {
    const onBack = vi.fn()
    const { stdin, lastFrame } = render(<Harness onBack={onBack} />)
    stdin.write(ESC)
    await settle()
    // Empty means the proposed name, shown in its place.
    expect(plain(lastFrame())).toContain('› test.jpg   in  Desktop ▾')
    expect(onBack).not.toHaveBeenCalled()
    stdin.write(ESC)
    await settle()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('Save as, the folder', () => {
  it('offers choose, save and make default, with esc returning to the name', async () => {
    const { stdin, lastFrame } = render(<Harness />)
    stdin.write(TAB)
    await settle()
    const keys = plain(lastFrame()).trimEnd().split('\n').at(-1) ?? ''
    expect(keys).toMatch(
      /^ {2}↑↓ {2}choose {3}↵ {2}save {3}tab {2}make default +esc name · ctrl-c quit$/,
    )
  })

  it('reports each highlighted folder as it is reached', async () => {
    const onFolder = vi.fn()
    const { stdin } = render(<Harness onFolder={onFolder} />)
    stdin.write(TAB)
    await settle()
    stdin.write(DOWN)
    await settle()
    expect(onFolder).toHaveBeenLastCalledWith(join(root, 'Downloads'))
    stdin.write(UP)
    stdin.write(UP)
    await settle()
    expect(onFolder).toHaveBeenLastCalledWith(join(root, 'Pictures'))
  })

  it('saves to the highlighted folder with the name as typed', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header')
  })

  it('closes the list on esc and returns to the name, keeping the folder', async () => {
    const { stdin, lastFrame } = render(<Harness />)
    stdin.write(TAB)
    await settle()
    stdin.write(DOWN)
    await settle()
    stdin.write(ESC)
    await settle()
    expect(plain(lastFrame())).toContain('› header.jpg   in  Downloads ▾')
    expect(plain(lastFrame())).not.toContain('Same folder')
  })

  it('does nothing on tab when the highlighted folder is already the default', async () => {
    const onMakeDefault = vi.fn()
    const { stdin } = render(<Harness onMakeDefault={onMakeDefault} />)
    stdin.write(TAB)
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).not.toHaveBeenCalled()
  })
})

describe('Save as, typing to find a folder', () => {
  it('shows what is typed in the pill and narrows the list', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write('dow')
    await settle()
    const out = plain(lastFrame())
    expect(out).toContain('› header.jpg   in  dow  ')
    expect(out).toContain('Downloads')
    expect(out).not.toContain('Same folder')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header')
  })

  it('keeps esc working when nothing matches, and ↵ does nothing', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write('zzz')
    await settle()
    expect(plain(lastFrame())).toContain('no match')
    expect(plain(lastFrame())).toContain('type a path, or drop a file')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
    stdin.write(ESC)
    await settle()
    expect(plain(lastFrame())).not.toContain('zzz')
    expect(plain(lastFrame())).toContain('Same folder') // still the list
    stdin.write(ESC)
    await settle()
    expect(plain(lastFrame())).not.toContain('Same folder') // back to the name
  })

  it('takes a typed folder as the place to save', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write('/Users/me/My\\ Folder')
    await settle()
    expect(plain(lastFrame())).toContain('Use this folder')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder', 'header')
  })

  it('saves next to a dropped file', async () => {
    const dir = join(await makeTempDir(), 'x y')
    await mkdir(dir)
    await writeFile(join(dir, 'a.png'), 'png')
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write(join(dir, 'a.png').replace(/ /g, '\\ '))
    await settle()
    expect(plain(lastFrame())).toContain('Next to a.png')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(dir, 'header')
  })

  it('does not offer a typed path as a default', async () => {
    const onMakeDefault = vi.fn()
    const { stdin } = render(<Harness onMakeDefault={onMakeDefault} />)
    stdin.write(TAB)
    await settle()
    stdin.write('/tmp/somewhere')
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).not.toHaveBeenCalled()
  })

  it('saves the pasted path, not a stale folder, when ↵ lands before a redraw', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write('/tmp/foo')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('/tmp/foo', 'header')
  })

  it('saves the unescaped path when a drop and its CR arrive in one write', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write(`/Users/me/My\\ Folder${ENTER}`)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder', 'header')
  })

  it('filters a DSR reply and a mouse report out of a typed path, without blocking legal brackets', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(TAB)
    await settle()
    stdin.write('/tmp/a')
    await settle()
    stdin.write('\x1b[24;1R')
    await settle()
    stdin.write('\x1b[<0;12;34M')
    await settle()
    stdin.write('\x1b[<0;12;34m')
    await settle()
    stdin.write('shot[1].png')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/tmp/ashot[1].png', 'header')
  })
})

describe('Save as, fitting the terminal', () => {
  it('never draws past the width it was given', async () => {
    for (const width of [40, 55, 80]) {
      const { stdin, lastFrame } = render(<Harness width={width} />)
      for (const line of lines(plain(lastFrame())))
        expect(stringWidth(line)).toBeLessThanOrEqual(width)
      stdin.write(TAB)
      await settle()
      for (const line of lines(plain(lastFrame())))
        expect(stringWidth(line)).toBeLessThanOrEqual(width)
      expect(plain(lastFrame())).toContain('Same folder')
    }
  })

  it('drops the paths when the band is compact', async () => {
    const { stdin, lastFrame } = render(<Harness width={50} />)
    stdin.write(TAB)
    await settle()
    expect(plain(lastFrame())).toContain('Desktop')
    expect(plain(lastFrame())).not.toContain('~/Desktop')
  })
})

describe('Save as, many files', () => {
  it('opens on the folder with the outputs named, not editable, and esc goes back', async () => {
    const onBack = vi.fn()
    const { stdin, lastFrame } = render(
      <Harness fixedName="report-1.jpg … 12 files" ext="" onBack={onBack} />,
    )
    const out = plain(lastFrame())
    expect(out).toContain('› report-1.jpg … 12 files   in  Desktop')
    expect(out).toContain('Same folder')
    expect(out.trimEnd().split('\n').at(-1)).toMatch(/esc back · ctrl-c quit$/)
    stdin.write(ESC)
    await settle()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('Save as, by mouse', () => {
  it('saves to a folder when its row is clicked', async () => {
    const onSubmit = vi.fn()
    let registry!: ReturnType<typeof useClickTargetRegistry>
    function Probe() {
      registry = useClickTargetRegistry()
      return null
    }
    const { stdin } = render(
      <ClickTargetProvider>
        <Probe />
        <Harness onSubmit={onSubmit} />
      </ClickTargetProvider>,
    )
    stdin.write(TAB)
    await settle()
    // The title, two blank rows, the field's padding, the sentence, a blank
    // row: the folders start on row 6, so Downloads is row 8.
    const target = registry.hitTest({ row: 8, col: 24 })
    expect(target).not.toBeNull()
    target?.onClick({ row: 0, col: 4 })
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header')
  })
})

describe('Save as without colour', () => {
  afterEach(() => {
    process.env.NO_COLOR = ''
  })

  it('draws no fill, brackets the folder you are on, and shows the caret as a glyph', async () => {
    process.env.NO_COLOR = '1'
    const { stdin, lastFrame } = render(<Harness />)
    expect(lastFrame()).not.toContain('48;2;')
    expect(plain(lastFrame())).toContain('› header▏.jpg   in  Desktop ▾')
    stdin.write(TAB)
    await settle()
    expect(lastFrame()).not.toContain('48;2;')
    expect(plain(lastFrame())).toContain('› header.jpg   in [Desktop]')
    expect(plain(lastFrame())).toMatch(/▌ Desktop +~\/Desktop +default/)
  })
})
