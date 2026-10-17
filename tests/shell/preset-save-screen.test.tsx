import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { PresetSaveScreen } from '../../src/shell/components/PresetSave.js'
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
/** Every window on screen is whole: each top edge that opens with ╭ closes with ╮, each bottom with ╯. */
function expectWhole(frame: string) {
  for (const line of frame.split('\n')) {
    const opens = (line.match(/╭/g) ?? []).length
    expect((line.match(/╮/g) ?? []).length, line).toBe(opens)
    expect((line.match(/╰/g) ?? []).length, line).toBe((line.match(/╯/g) ?? []).length)
  }
}
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const plain = (app: { lastFrame: () => string | undefined }) =>
  (app.lastFrame() ?? '').replace(SGR, '')
async function type(app: { stdin: { write: (s: string) => void } }, text: string) {
  for (const ch of text) {
    app.stdin.write(ch)
    await settle(20)
  }
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

function mount(o: { taken?: string[]; name?: string; width?: number } = {}) {
  setMotionForTests(false)
  const onSave = vi.fn()
  const onCancel = vi.fn()
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <PresetSaveScreen
        mode="convert"
        trail={{ answers: ['WebP', '80', 'Desktop', 'photo.webp'], current: 'Done' }}
        result={result}
        width={o.width ?? 80}
        height={24}
        name={o.name ?? ''}
        taken={o.taken ?? []}
        folders={[
          { label: 'Desktop', value: '~/Desktop', path: '~/Desktop' },
          { label: 'Same location', value: 'same' },
          { label: 'Downloads', value: '~/Downloads', path: '~/Downloads' },
          { label: 'Ask each time', value: 'ask' },
        ]}
        defaultValue="~/Desktop"
        onSave={onSave}
        onCancel={onCancel}
      />
    </ThemeProvider>,
  )
  return { app, onSave, onCancel }
}

describe('Save as preset, the window', () => {
  it('holds Save as’s block: the name, a rule, the folders, the default tagged', async () => {
    const { app } = mount()
    await settle()
    const frame = plain(app)
    expect(frame).toContain('Save as preset')
    expect(frame).toMatch(/name {4}/)
    expect(frame).toMatch(/to {6}▌ Desktop +~\/Desktop +default/)
    expect(frame).toContain('Same location')
    expect(frame).toContain('Ask each time')
    expect(frame).toMatch(/↵ {2}save {3}↑↓ {2}folder {3}\/ {2}new folder/)
  })

  it('saves the typed name to the highlighted folder', async () => {
    const { app, onSave } = mount()
    await type(app, 'blog')
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: '~/Desktop' })
  })

  it('saves to Same location with ↓ first', async () => {
    const { app, onSave } = mount()
    await type(app, 'blog')
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: 'same' })
  })

  it('takes only letters, digits and dashes in the name', async () => {
    const { app, onSave } = mount()
    await type(app, 'my blog!')
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'myblog', saveTo: '~/Desktop' })
  })

  it('says a name is taken, and does not save over it', async () => {
    const { app, onSave } = mount({ taken: ['blog'] })
    await type(app, 'blog')
    expect(plain(app)).toContain('blog is taken')
    app.stdin.write('\r')
    await settle()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('makes a new folder inside the highlighted one with /', async () => {
    const { app, onSave } = mount()
    await type(app, 'blog')
    app.stdin.write('/')
    await settle()
    expect(plain(app)).toContain('└')
    await type(app, 'imgs')
    expect(plain(app)).toContain('new folder')
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: '~/Desktop/imgs' })
  })

  it('goes on esc', async () => {
    const { app, onCancel } = mount()
    await settle()
    app.stdin.write(ESC)
    await settle(120)
    expect(onCancel).toHaveBeenCalled()
  })

  it('fits a narrow terminal', async () => {
    const { app } = mount({ width: 56 })
    await settle()
    expectWhole(plain(app))
    expect(plain(app)).toContain('Save as preset')
    expect(plain(app)).toContain('Ask each time')
  })
})
