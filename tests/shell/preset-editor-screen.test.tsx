import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { PresetSteps } from '../../src/core/preset.js'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { PresetEditorScreen } from '../../src/shell/components/PresetEditor.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const DOWN = `${ESC}[B`
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

function mount(o: { onDone?: (s: PresetSteps) => void; onCancel?: () => void } = {}) {
  setMotionForTests(false)
  const runs: PresetSteps[] = []
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <PresetEditorScreen
        mode="convert"
        trail={{ answers: ['WebP', '80', 'Desktop', 'photo.webp'], current: 'Done' }}
        result={result}
        width={80}
        height={24}
        targets={['jpeg', 'webp', 'avif', 'png']}
        scales={[2, 3, 4]}
        cutout
        run={async (steps) => {
          runs.push(steps)
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
})
