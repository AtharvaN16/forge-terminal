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
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'

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

/** The mockup's folders, made real in a temp root shown as `~`. */
let root = ''
let presets: PathPreset[] = []
const display = (p: string) => p.replace(root, '~')
beforeAll(async () => {
  root = await makeTempDir()
  for (const d of ['Pictures', 'Desktop', 'Downloads', 'Documents']) await mkdir(join(root, d))
  await mkdir(join(root, 'Documents', 'Scans'))
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

/** The field's rows, plain, from the name row down. */
const field = (f: string | undefined) => {
  const ls = lines(plain(f))
  const at = ls.findIndex((l) => l.includes('name   '))
  return ls.slice(at)
}
const keyRow = (f: string | undefined) => plain(f).trimEnd().split('\n').at(-1) ?? ''

describe('Save as (V10c): the block', () => {
  it('titles the question, then the name filled and underlined, a rule, and the folders', () => {
    const f = render(<Harness />).lastFrame()
    const out = lines(plain(f))
    expect(out[0]).toMatch(/^ Save as$/)
    const rows = field(f)
    expect(rows[0]).toMatch(/^ {3}name {5}header +\.jpg *$/)
    expect(rows[1]).toMatch(/^ {11}▔{26} *$/)
    expect(rows[2]).toMatch(/^ {3}─+ *$/)
    // The folder it will save to is highlighted, with its path; the rest are names.
    expect(plain(f)).toMatch(/▌ Desktop +~\/Desktop +default/)
    expect(plain(f)).not.toContain('~/Pictures')
    expect(plain(f)).toMatch(/ {2}Type the path here {2}or drop a folder/)
  })

  it('fills the name with the mode’s tint and edges the block in its colour', () => {
    const raw = render(<Harness />).lastFrame() ?? ''
    const tint = modePalette(DARK, 'convert').band
    const rgb = (h: string) =>
      [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(';')
    expect(raw).toContain(`48;2;${rgb(tint)}`)
  })

  it('offers save, folder and make default, with back and quit as the footnote', () => {
    expect(keyRow(render(<Harness />).lastFrame())).toMatch(
      /^ {2}↵ {2}save {3}↑↓ {2}folder {3}tab {2}make default +esc back · ctrl-c quit$/,
    )
  })

  it('says what the job will do at the title’s right, quietly', () => {
    const out = plain(render(<Harness aside="Rotate 90°" />).lastFrame())
    expect(out.split('\n')[0]).toMatch(/^ Save as +Rotate 90°$/)
  })
})

describe('Save as (V10c): the name', () => {
  it('takes typing, and saves with the name and folder on ↵', async () => {
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
    expect(field(lastFrame())[0]).toMatch(/name {5}test/)
    expect(onBack).not.toHaveBeenCalled()
    stdin.write(ESC)
    await settle()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('Save as (V10c): the folders', () => {
  it('moves the highlight with ↓ while the caret stays in the name', async () => {
    const onSubmit = vi.fn()
    const onFolder = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} onFolder={onFolder} />)
    stdin.write(DOWN)
    await settle()
    expect(onFolder).toHaveBeenLastCalledWith(join(root, 'Downloads'))
    expect(plain(lastFrame())).toMatch(/▌ Downloads +~\/Downloads/)
    expect(plain(lastFrame())).not.toContain('~/Desktop ')
    stdin.write('-2')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header-2')
  })

  it('stops at the top, as the pickers do', async () => {
    const onFolder = vi.fn()
    const { stdin } = render(<Harness onFolder={onFolder} />)
    stdin.write(UP)
    stdin.write(UP)
    stdin.write(UP)
    await settle()
    expect(onFolder).toHaveBeenLastCalledWith(join(root, 'Pictures'))
  })

  it('moves the tag the moment tab makes the highlighted folder the default', async () => {
    const onMakeDefault = vi.fn()
    const { stdin, lastFrame } = render(<Harness onMakeDefault={onMakeDefault} />)
    stdin.write(TAB) // already the default: nothing
    await settle()
    expect(onMakeDefault).not.toHaveBeenCalled()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).toHaveBeenCalledWith(join(root, 'Downloads'))
    expect(plain(lastFrame())).toMatch(/▌ Downloads +~\/Downloads +default/)
  })
})

describe('Save as (V10c): the highlight follows the folder, not the row', () => {
  it('stays on the folder when making it the default moves it in the list', async () => {
    // Presets that put the default first, as the app's do.
    const ordered = (def: string) => [
      ...presets.filter((p) => p.path === def),
      ...presets.filter((p) => p.path !== def),
    ]
    function Reordering() {
      const [def, setDef] = useState(join(root, 'Desktop'))
      return <Harness presets={ordered(def)} defaultPath={def} onMakeDefault={(p) => setDef(p)} />
    }
    const { stdin, lastFrame } = render(<Reordering />)
    stdin.write(DOWN)
    await settle()
    expect(plain(lastFrame())).toMatch(/▌ Same folder/)
    stdin.write(TAB)
    await settle()
    // Same folder is the default now, and first; the highlight is still on it.
    expect(plain(lastFrame())).toMatch(/to {6}▌ Same folder .* default/)
  })
})

describe('Save as (V10c): the path row', () => {
  /** ↓ past every folder: the five presets, then the path row. */
  const toPathRow = async (stdin: { write: (s: string) => void }) => {
    for (let i = 0; i < 6; i++) stdin.write(DOWN)
    await settle()
  }

  it('is reached with ↓ past the last folder, and ↑ leaves it', async () => {
    const { stdin, lastFrame } = render(<Harness />)
    await toPathRow(stdin)
    expect(plain(lastFrame())).toMatch(/▌ Type the path here/)
    expect(keyRow(lastFrame())).toMatch(/^ {2}↑ {2}folders +esc back · ctrl-c quit$/)
    stdin.write(UP)
    await settle()
    expect(keyRow(lastFrame())).toMatch(/tab {2}make default/)
  })

  it('takes a typed path, tags one that does not exist yet, and saves there', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    await toPathRow(stdin)
    stdin.write('/')
    stdin.write('tmp/forge-nope')
    await settle(150)
    expect(plain(lastFrame())).toMatch(/▌ \/tmp\/forge-nope +new folder/)
    expect(keyRow(lastFrame())).toMatch(/↵ {2}make it and save {3}↑ {2}folders +esc clear path/)
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/tmp/forge-nope', 'header')
  })

  it('shows the rest of a matching folder dim, and tab takes it', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    await toPathRow(stdin)
    // A path typed: the keys arrive one at a time (a chunk would be a drop).
    stdin.write(`${root}/Documents/`)
    await settle()
    stdin.write('S')
    stdin.write('c')
    await settle(200)
    expect(plain(lastFrame())).toMatch(/Documents\/Sc.?ans\/ +tab completes/)
    stdin.write(TAB)
    await settle(150)
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Documents', 'Scans/'), 'header')
  })

  it('narrows the folders to what is typed, and saves to the first that matches', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    await toPathRow(stdin)
    stdin.write('d')
    stdin.write('ow')
    await settle()
    expect(plain(lastFrame())).toContain('Downloads')
    expect(plain(lastFrame())).not.toContain('Same folder')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header')
  })

  it('says when nothing matches, keeps ↵ from saving, and esc clears then leaves', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    await toPathRow(stdin)
    stdin.write('z')
    stdin.write('zz')
    await settle()
    expect(plain(lastFrame())).toMatch(/▌ zzz +no match/)
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
    stdin.write(ESC)
    await settle()
    expect(plain(lastFrame())).not.toContain('zzz')
    expect(plain(lastFrame())).toContain('Same folder')
    stdin.write(ESC)
    await settle()
    expect(keyRow(lastFrame())).toMatch(/tab {2}make default/)
  })
})

describe('Save as (V10c): a drop', () => {
  it('lands a dropped folder on the path row, chosen, its name and where it is', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(join(root, 'Documents', 'Scans'))
    await settle()
    expect(plain(lastFrame())).toMatch(/▌ Scans +~\/Documents\/Scans/)
    expect(field(lastFrame())[0]).toMatch(/name {5}header/)
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Documents', 'Scans'), 'header')
  })

  it('saves next to a dropped file', async () => {
    const dir = join(await makeTempDir(), 'x y')
    await mkdir(dir)
    await writeFile(join(dir, 'a.png'), 'png')
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(join(dir, 'a.png').replace(/ /g, '\\ '))
    await settle()
    expect(plain(lastFrame())).toContain('Next to a.png')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(dir, 'header')
  })

  it('saves the pasted path, not a stale folder, when ↵ lands before a redraw', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write('/tmp/foo')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('/tmp/foo', 'header')
  })

  it('saves the unescaped path when a drop and its CR arrive in one write', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
    stdin.write(`/Users/me/My\\ Folder${ENTER}`)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder', 'header')
  })

  it('filters a DSR reply and a mouse report out of a typed path, without blocking legal brackets', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Harness onSubmit={onSubmit} />)
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

  it('does not offer a path as a default', async () => {
    const onMakeDefault = vi.fn()
    const { stdin } = render(<Harness onMakeDefault={onMakeDefault} />)
    stdin.write('/tmp/somewhere')
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).not.toHaveBeenCalled()
  })
})

describe('Save as (V10c), fitting the terminal', () => {
  it('never draws past the width it was given', async () => {
    for (const width of [40, 55, 80]) {
      const { stdin, lastFrame } = render(<Harness width={width} />)
      for (const line of lines(plain(lastFrame())))
        expect(stringWidth(line)).toBeLessThanOrEqual(width)
      stdin.write(DOWN)
      await settle()
      for (const line of lines(plain(lastFrame())))
        expect(stringWidth(line)).toBeLessThanOrEqual(width)
      expect(plain(lastFrame())).toContain('Same folder')
    }
  })

  it('drops the paths when the band is compact', () => {
    const out = plain(render(<Harness width={50} />).lastFrame())
    expect(out).toContain('Desktop')
    expect(out).not.toContain('~/Desktop')
  })
})

describe('Save as (V10c), many files', () => {
  it('says what will be written instead of a name, keeps the folders, and esc goes back', async () => {
    const onBack = vi.fn()
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(
      <Harness fixedName="report-1.jpg … 12 files" ext="" onBack={onBack} onSubmit={onSubmit} />,
    )
    expect(plain(lastFrame())).toMatch(/files {3}report-1\.jpg … 12 files/)
    expect(plain(lastFrame())).toContain('Same folder')
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header')
    stdin.write(ESC)
    await settle()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('Save as (V10c), by mouse', () => {
  it('saves to a folder when its row is clicked', async () => {
    const onSubmit = vi.fn()
    let registry!: ReturnType<typeof useClickTargetRegistry>
    function Probe() {
      registry = useClickTargetRegistry()
      return null
    }
    const { lastFrame } = render(
      <ClickTargetProvider>
        <Probe />
        <Harness onSubmit={onSubmit} />
      </ClickTargetProvider>,
    )
    await settle()
    const row = lines(plain(lastFrame())).findIndex((l) => l.includes('Downloads'))
    const target = registry.hitTest({ row, col: 24 })
    expect(target).not.toBeNull()
    target?.onClick({ row: 0, col: 4 })
    expect(onSubmit).toHaveBeenCalledWith(join(root, 'Downloads'), 'header')
  })
})

describe('Save as (V10c) without colour', () => {
  afterEach(() => {
    process.env.NO_COLOR = ''
  })

  it('draws no fill, keeps the underline and the strip, and shows the caret as a glyph', () => {
    process.env.NO_COLOR = '1'
    const out = render(<Harness />).lastFrame() ?? ''
    expect(out).not.toContain('48;2;')
    expect(plain(out)).toMatch(/name {5}header▏/)
    expect(plain(out)).toContain('▔'.repeat(26))
    expect(plain(out)).toMatch(/▌ Desktop +~\/Desktop +default/)
  })
})

describe('Save as (V10c), in motion (M3)', () => {
  afterEach(() => {
    vi.useRealTimers()
    setMotionForTests(undefined)
  })
  /** The frame `keys` leave once everything has settled, with motion off. */
  async function rest(...keys: string[]) {
    setMotionForTests(false)
    const app = render(<Harness />)
    for (const k of keys) {
      app.stdin.write(k)
      await settle()
    }
    const frame = app.lastFrame()
    app.unmount()
    return frame
  }
  /** Motion on, the clock held still until the test moves it. */
  function moving() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    setMotionForTests(true)
    return render(<Harness />)
  }
  const tick = async (ms: number) => {
    vi.advanceTimersByTime(ms)
    await settle(20)
  }

  it('glides the highlight from one folder to the next, then rests where it went', async () => {
    const before = await rest()
    const after = await rest(DOWN)
    const app = moving()
    await settle()
    expect(app.lastFrame()).toBe(before)
    app.stdin.write(DOWN)
    await settle()
    await tick(50)
    const mid = app.lastFrame()
    expect(mid).not.toBe(before)
    expect(mid).not.toBe(after)
    await tick(200)
    expect(app.lastFrame()).toBe(after)
  })

  it('fades the default’s tag across when tab moves it', async () => {
    const after = await rest(DOWN, TAB)
    const app = moving()
    app.stdin.write(DOWN)
    await settle()
    await tick(300)
    const moved = app.lastFrame()
    app.stdin.write(TAB)
    await settle()
    await tick(50)
    expect(app.lastFrame()).not.toBe(moved)
    expect(app.lastFrame()).not.toBe(after)
    await tick(200)
    expect(app.lastFrame()).toBe(after)
  })

  it('lights the path row when a folder is dropped, then lets it fade back to the band', async () => {
    const scans = join(root, 'Documents', 'Scans')
    const after = await rest(scans)
    const app = moving()
    app.stdin.write(scans)
    await settle()
    await tick(160)
    const lit = lines(app.lastFrame()).find((l) => plain(l).includes('▌ Scans')) ?? ''
    const settled = lines(after).find((l) => plain(l).includes('▌ Scans')) ?? ''
    expect(plain(lit)).toBe(plain(settled))
    expect(lit).not.toBe(settled)
    await tick(500)
    expect(app.lastFrame()).toBe(after)
  })
})
