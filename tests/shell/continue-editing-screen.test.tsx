import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { PlanEvent } from '../../src/core/execute-jobs.js'
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
    /** Replaces the rerun: it is handed the run's event sink. */
    rerun?: (onEvent: (e: PlanEvent) => void) => Promise<Rerun>
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
        run={async (steps, _signal, onEvent): Promise<Rerun> => {
          runs.push(steps)
          if (o.rerun) return o.rerun(onEvent)
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

  it('opens each sub-picker on its first row, whatever row of the list led to it', async () => {
    const { app, finish } = mount()
    await until(app, 'Continue editing')
    for (let i = 0; i < 6; i++) {
      app.stdin.write(DOWN) // … down to Boost resolution
      await settle()
    }
    app.stdin.write(ENTER)
    await until(app, '2×')
    app.stdin.write(ENTER) // the cursor is on 2×, so ↵ chooses it
    const start = Date.now()
    while (finish.mock.calls.length === 0 && Date.now() - start < 3_000) await settle(20)
    expect(finish.mock.calls[0]?.[2]).toEqual({ kind: 'add', step: { op: 'boost', scale: 2 } })
  })

  it('shows the tiles a model has done of all there are, and the time left, while it runs', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    const { app, finish } = mount({
      rerun: async (onEvent) => {
        const job = result.job
        const tiles = (done: number) =>
          onEvent({ type: 'job:phase', job, progress: { phase: 'tiles', done, total: 48 } })
        tiles(0)
        tiles(12)
        await held
        return { kind: 'ready', output: join(DESKTOP, 'IMG_2041.jpg'), bytes: 402_000 }
      },
    })
    await until(app, 'Continue editing')
    for (let i = 0; i < 5; i++) {
      app.stdin.write(DOWN) // … down to Sharpen
      await settle()
    }
    app.stdin.write(ENTER)
    await until(app, '12 of 48')
    expect(plain(app)).not.toMatch(/tiles/i)
    release()
    const start = Date.now()
    while (finish.mock.calls.length === 0 && Date.now() - start < 3_000) await settle(20)
    expect(finish.mock.calls[0]?.[2]).toEqual({ kind: 'add', step: { op: 'sharpen' } })
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
