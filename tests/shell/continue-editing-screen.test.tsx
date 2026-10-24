import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { PresetSteps } from '../../src/core/preset.js'
import type { ImageInfo, Result } from '../../src/core/types.js'
import { ContinueEditingScreen, type Rerun } from '../../src/shell/components/ContinueEditing.js'
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
const LEFT = `${ESC}[D`
const ENTER = '\r'
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const plain = (app: { lastFrame: () => string | undefined }) =>
  (app.lastFrame() ?? '').replace(SGR, '')
async function until(app: { lastFrame: () => string | undefined }, text: string) {
  const start = Date.now()
  while (!plain(app).includes(text) && Date.now() - start < 3_000) await settle(20)
  expect(plain(app)).toContain(text)
}

const DESKTOP = join(homedir(), 'Desktop')
const original: ImageInfo = {
  kind: 'image',
  path: join(DESKTOP, 'IMG_2041.png'),
  format: 'png',
  bytes: 16_000_000,
  width: 3000,
  height: 2000,
  hasAlpha: false,
  frames: 1,
} as ImageInfo
const result: Result = {
  job: {
    op: 'convert',
    sources: [original],
    outputs: [join(DESKTOP, 'IMG_2041.jpg')],
    target: 'jpeg',
    options: { background: '#ffffff', keepMetadata: false, quality: 80 },
  },
  outputBytes: 708_000,
  warnings: [],
}

function mount(
  o: {
    undo?: { label: string; steps: PresetSteps }
    missing?: Record<string, number>
    reasons?: Record<string, string>
  } = {},
) {
  setMotionForTests(false)
  const runs: PresetSteps[] = []
  const finish = vi.fn()
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <ContinueEditingScreen
        mode="convert"
        trail={{ answers: ['JPEG', '80', 'Desktop', 'IMG_2041.jpg'], current: 'Done' }}
        result={result}
        original={original}
        steps={{ to: 'jpeg', quality: 80 }}
        undo={o.undo}
        targets={['jpeg', 'webp', 'avif', 'png']}
        scales={[2, 3, 4]}
        cutout
        reasons={o.reasons ?? {}}
        missing={o.missing ?? {}}
        onAdd={async () => true}
        run={async (steps): Promise<Rerun> => {
          runs.push(steps)
          return { kind: 'ready', output: join(DESKTOP, 'IMG_2041.jpg'), bytes: 402_000 }
        }}
        onFinish={finish}
        onFail={() => {}}
        onCancel={() => {}}
        width={80}
        height={24}
      />
    </ThemeProvider>,
  )
  return { app, runs, finish }
}

describe('Continue editing: one more thing done to the file', () => {
  it('opens on one list of every operation, the chain so far at the title’s right with ? for the next', async () => {
    const { app } = mount()
    await until(app, 'Continue editing')
    const frame = plain(app)
    expect(frame).toMatch(/Continue editing +PNG ─▸ JPEG 80 ─▸ {2}\? /)
    for (const label of [
      'Compress',
      'Resize',
      'Crop to shape',
      'Trim edges',
      'Convert to another format',
      'Remove background',
    ])
      expect(frame).toContain(label)
    expect(frame).toContain('↵ select')
    expect(frame).toContain('esc back to Done')
  })

  it('runs a step on its own screen, then hands the steps and the new file back for Done', async () => {
    const { app, runs, finish } = mount()
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Resize to')
    app.stdin.write(LEFT) // 95 %
    await settle()
    app.stdin.write(ENTER)
    const start = Date.now()
    while (finish.mock.calls.length === 0 && Date.now() - start < 3_000) await settle(20)
    expect(runs.at(-1)).toEqual({ to: 'jpeg', quality: 80, resize: { percent: 95 } })
    expect(finish.mock.calls[0]?.[1]).toMatchObject({ kind: 'ready', bytes: 402_000 })
    expect(finish.mock.calls[0]?.[2]).toEqual({
      kind: 'add',
      step: { op: 'resize', spec: { percent: 95 } },
    })
  })

  it('offers Undo for the last step on top, and undoing reruns the steps without it', async () => {
    const { app, runs, finish } = mount({
      undo: { label: '1920 wide', steps: { to: 'jpeg', quality: 80 } },
    })
    await until(app, 'Undo 1920 wide')
    app.stdin.write(ENTER)
    const start = Date.now()
    while (finish.mock.calls.length === 0 && Date.now() - start < 3_000) await settle(20)
    expect(runs.at(-1)).toEqual({ to: 'jpeg', quality: 80 })
    expect(finish.mock.calls[0]?.[2]).toEqual({ kind: 'undo' })
  })

  it('says why an operation cannot apply, and offers a model that is not added', async () => {
    const { app } = mount({ reasons: { trim: 'no empty edges' }, missing: { sharpen: 41_000_000 } })
    await until(app, 'no empty edges')
    expect(plain(app)).toContain('not added · 41 MB')
  })
})
