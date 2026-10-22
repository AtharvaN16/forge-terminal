import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { PresetSteps } from '../../src/core/preset.js'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { PresetEditorScreen } from '../../src/shell/components/PresetEditor.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import type { OpId } from '../../src/shell/preset-editor.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const DOWN = `${ESC}[B`
/** Every window on screen is whole: each top edge that opens with ╭ closes with ╮, each bottom with ╯. */
function expectWhole(frame: string) {
  for (const line of frame.split('\n')) {
    const opens = (line.match(/╭/g) ?? []).length
    expect((line.match(/╮/g) ?? []).length, line).toBe(opens)
    expect((line.match(/╰/g) ?? []).length, line).toBe((line.match(/╯/g) ?? []).length)
  }
}
const RIGHT = `${ESC}[C`
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const plain = (app: { lastFrame: () => string | undefined }) =>
  (app.lastFrame() ?? '').replace(SGR, '')
async function until(app: { lastFrame: () => string | undefined }, text: string) {
  const start = Date.now()
  while (!plain(app).includes(text) && Date.now() - start < 5_000) await settle(20)
  expect(plain(app)).toContain(text)
}

const DESKTOP = join(homedir(), 'Desktop')
const result: Result = {
  job: {
    op: 'convert',
    sources: [
      {
        kind: 'image',
        path: join(DESKTOP, 'photo.png'),
        format: 'png',
        bytes: 14_400_000,
        width: 3024,
        height: 2016,
        hasAlpha: false,
        frames: 1,
      } as SourceInfo,
    ],
    outputs: [join(DESKTOP, 'photo.webp')],
    target: 'webp',
    options: { background: '#ffffff', keepMetadata: false, quality: 80 },
  },
  outputBytes: 2_000_000,
  warnings: [],
}

function mount(
  o: {
    onDone?: (s: PresetSteps) => void
    onCancel?: () => void
    width?: number
    /** How long a rerun takes. */
    slow?: number
    reasons?: Partial<Record<OpId, string>>
    missing?: Partial<Record<OpId, number>>
    onAdd?: (id: OpId) => void
    /** What a rerun fails with, instead of a file. */
    fail?: string
  } = {},
) {
  setMotionForTests(false)
  const runs: PresetSteps[] = []
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <PresetEditorScreen
        mode="convert"
        trail={{ answers: ['WebP', '80', 'Desktop', 'photo.webp'], current: 'Done' }}
        result={result}
        width={o.width ?? 80}
        height={24}
        targets={['jpeg', 'webp', 'avif', 'png']}
        scales={[2, 3, 4]}
        cutout
        reasons={o.reasons}
        missing={o.missing}
        onAdd={o.onAdd}
        run={async (steps) => {
          runs.push(steps)
          if (o.slow) await settle(o.slow)
          if (o.fail) return { kind: 'failed', message: o.fail }
          return { kind: 'ready', output: join(DESKTOP, 'photo.webp'), bytes: 840_000 }
        }}
        onDone={o.onDone ?? (() => {})}
        onCancel={o.onCancel ?? (() => {})}
      />
    </ThemeProvider>,
  )
  return { app, runs }
}

describe('Continue editing, the window', () => {
  it('opens over Done with every operation a row and the window’s keys', async () => {
    const { app } = mount()
    await until(app, 'Continue editing')
    const frame = plain(app)
    expect(frame).toMatch(/● Convert to {9}WebP/)
    expect(frame).toMatch(/› ○ Compress/)
    expect(frame).toMatch(/↑↓ {2}choose {3}space {2}select {3}→ {2}more {3}↵ {2}done/)
    expect(frame).toContain('esc cancel')
  })

  it('reruns from the original as rows change, and the foot shows the file as it is now', async () => {
    const { app, runs } = mount()
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(DOWN) // Trim edges
    await settle()
    app.stdin.write(' ')
    await until(app, 'now 840 KB')
    expect(runs.at(-1)).toEqual({ to: 'webp', quality: 80, trim: true })
  })

  it('opens a row’s own window under it with →', async () => {
    const { app } = mount()
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(RIGHT)
    await until(app, '─ Resize ─')
  })

  it('hands the steps over on ↵, and goes on esc', async () => {
    const done = vi.fn()
    const cancel = vi.fn()
    const { app } = mount({ onDone: done, onCancel: cancel })
    await until(app, 'Continue editing')
    app.stdin.write('\r')
    await settle()
    expect(done.mock.calls[0]?.[0]).toMatchObject({ to: 'webp', quality: 80 })
    app.stdin.write(ESC)
    await settle(120)
    expect(cancel).toHaveBeenCalled()
  })

  it('fits a narrow terminal: the window and a row’s own window narrow to it', async () => {
    const { app } = mount({ width: 56 })
    await until(app, 'Continue editing')
    expectWhole(plain(app))
    expect(plain(app)).toMatch(/○ Remove background/)
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(RIGHT)
    await until(app, '─ Resize ─')
    expectWhole(plain(app))
  })

  it('spins while a slow rerun works, saying what it is doing, then shows the file', async () => {
    const { app } = mount({ slow: 1500 })
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(DOWN) // Trim edges
    await settle()
    app.stdin.write(' ')
    await until(app, 'Trimming')
    expect(plain(app)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Trimming/)
    await until(app, 'now 840 KB')
    expect(plain(app)).not.toContain('Trimming')
  })

  it('stops spinning when a change is undone while its rerun works', async () => {
    const { app } = mount({ slow: 1500 })
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(DOWN) // Trim edges
    await settle()
    app.stdin.write(' ')
    await until(app, 'Trimming')
    app.stdin.write(' ') // back to Done's own steps
    await settle(400)
    expect(plain(app)).not.toContain('Trimming')
    expect(plain(app)).toContain('✓ photo.webp')
  })

  it('waits for a rerun still working on ↵, then hands over its file with its steps', async () => {
    const done = vi.fn()
    const { app } = mount({ slow: 800, onDone: done })
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(DOWN) // Trim edges
    await settle()
    app.stdin.write(' ')
    await settle()
    app.stdin.write('\r')
    await settle(300)
    expect(done).not.toHaveBeenCalled()
    const start = Date.now()
    while (done.mock.calls.length === 0 && Date.now() - start < 3_000) await settle(20)
    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0]?.[0]).toEqual({ to: 'webp', quality: 80, trim: true })
    expect(done.mock.calls[0]?.[1]).toMatchObject({ kind: 'ready', bytes: 840_000 })
  })

  it('says a failed rerun in full, wrapped inside the window', async () => {
    const fail =
      'photo.png can’t get under 5 KB: the smallest it gets is 182 KB, at the lowest quality'
    const { app } = mount({ fail })
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(DOWN) // Trim edges
    await settle()
    app.stdin.write(' ')
    await until(app, '✕')
    expectWhole(plain(app))
    const inside = plain(app)
      .split('\n')
      .map((l) => /│(.*)│/.exec(l)?.[1]?.trim() ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
    expect(inside).toContain(`✕ ${fail}`)
  })

  it('says nothing for a quick rerun: no spinner flashes up', async () => {
    const { app } = mount({ slow: 50 })
    await until(app, 'Continue editing')
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(DOWN)
    await settle()
    const frames: string[] = []
    const seen = setInterval(() => frames.push(plain(app)), 20)
    app.stdin.write(' ')
    await until(app, 'now 840 KB')
    clearInterval(seen)
    expect(frames.some((f) => f.includes('Trimming'))).toBe(false)
  })

  it('dims a row that cannot apply, with its reason, and space does nothing there', async () => {
    const { app, runs } = mount({ reasons: { trim: 'no empty edges' } })
    await until(app, 'no empty edges')
    expect(plain(app)).toMatch(/○ Trim edges {9}no empty edges/)
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(DOWN) // Trim edges
    await settle()
    expect(plain(app)).toMatch(/↑↓ {2}choose/)
    expect(plain(app)).not.toMatch(/space {2}select/)
    app.stdin.write(' ')
    await settle(400)
    expect(runs).toHaveLength(0)
  })

  it('offers a missing extension under its row, and asks the shell to add it on ↵', async () => {
    const add = vi.fn()
    const { app } = mount({ missing: { sharpen: 41_000_000 }, onAdd: add })
    await until(app, 'not added')
    for (const _ of [1, 2, 3, 4]) {
      app.stdin.write(DOWN) // Resize, Trim edges, Crop to shape, Sharpen
      await settle()
    }
    app.stdin.write(' ')
    await until(app, 'add · 41 MB')
    expect(plain(app)).toMatch(/↵ {2}add/)
    app.stdin.write('\r')
    await until(app, 'adding')
    expect(add).toHaveBeenCalledWith('sharpen')
  })
})
