import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { PresetSaveScreen, presetFolders } from '../../src/shell/components/PresetSave.js'
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
const UP = `${ESC}[A`
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
  const onMakeDefault = vi.fn()
  // The default lives above the window, as in the app: tab moves it, and the list follows.
  function Window() {
    const [defaultOutput, setDefault] = useState('~/Desktop')
    return (
      <PresetSaveScreen
        mode="convert"
        trail={{ answers: ['WebP', '80', 'Desktop', 'photo.webp'], current: 'Done' }}
        result={result}
        width={o.width ?? 80}
        height={24}
        name={o.name ?? ''}
        taken={o.taken ?? []}
        folders={presetFolders(defaultOutput)}
        defaultValue={defaultOutput}
        onSave={onSave}
        onMakeDefault={(path) => {
          onMakeDefault(path)
          setDefault(path)
        }}
        onCancel={onCancel}
      />
    )
  }
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <Window />
    </ThemeProvider>,
  )
  return { app, onSave, onCancel, onMakeDefault }
}

describe('Save as preset, the window', () => {
  it('holds Save as’s block: the name, a rule, the folders, the default tagged', async () => {
    const { app } = mount()
    await settle()
    const frame = plain(app)
    expect(frame).toContain('Save as preset')
    // Each label no wider than eight, over two lines, so it never reads as a folder.
    expect(frame).toMatch(/│ +preset {4}/)
    expect(frame).toMatch(/name {6}▔/)
    expect(frame).toMatch(/save {6}▌ Desktop +~\/Desktop +default/)
    expect(frame).toMatch(/files to {4}Same location/)
    expect(frame).toContain('Same location')
    expect(frame).toContain('Ask each time')
    expect(frame).toMatch(/↵ {2}save {3}↑↓ {2}folder {3}tab {2}make default {3}\/ {2}new folder/)
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

  it('reaches the path row with ↓ past the last folder, and saves to a typed path', async () => {
    const { app, onSave } = mount()
    await type(app, 'blog')
    for (let i = 0; i < 4; i++) {
      app.stdin.write(DOWN)
      await settle(20)
    }
    await settle()
    expect(plain(app)).toMatch(/↑ {2}folders/)
    await type(app, '~/Pictures/blog')
    expect(plain(app)).toContain('~/Pictures/blog')
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: join(homedir(), 'Pictures/blog') })
  })

  it('narrows the folders by a name typed on the path row, and ↑ lets the list go', async () => {
    const { app, onSave } = mount()
    await type(app, 'blog')
    for (let i = 0; i < 4; i++) {
      app.stdin.write(DOWN)
      await settle(20)
    }
    await type(app, 'down')
    expect(plain(app)).not.toContain('Same location')
    app.stdin.write(UP)
    await settle()
    expect(plain(app)).toContain('Same location')
    for (let i = 0; i < 4; i++) {
      app.stdin.write(DOWN)
      await settle(20)
    }
    await type(app, 'down')
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: '~/Downloads' })
  })

  it('takes a dropped folder on the path row, and its ↵ saves there', async () => {
    const { app, onSave } = mount()
    await type(app, 'blog')
    app.stdin.write(`${DESKTOP}\r`)
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: DESKTOP })
  })

  it('clears a typed path on esc, then goes back up, and does not cancel', async () => {
    const { app, onCancel } = mount()
    for (let i = 0; i < 4; i++) {
      app.stdin.write(DOWN)
      await settle(20)
    }
    await type(app, '~/x')
    app.stdin.write(ESC)
    await settle(120)
    expect(plain(app)).toContain('Type the path here')
    app.stdin.write(ESC)
    await settle(120)
    expect(plain(app)).toMatch(/▌ Ask each time/)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('makes the highlighted folder the default with tab, the highlight staying on it', async () => {
    const { app, onMakeDefault, onSave } = mount()
    await type(app, 'blog')
    app.stdin.write(DOWN)
    await settle(20)
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write('\t')
    await settle()
    const downloads = join(homedir(), 'Downloads')
    expect(onMakeDefault).toHaveBeenCalledWith(downloads)
    // Downloads leads now, tagged, still highlighted; Desktop follows it once.
    expect(plain(app)).toMatch(/save {6}▌ Downloads +~\/Downloads +default/)
    expect(plain(app)).toMatch(/files to {4}Desktop/)
    // Once in the window: the trail above it says Desktop too.
    expect(plain(app).match(/│.*Desktop/g)?.length).toBe(1)
    app.stdin.write('\r')
    await settle()
    expect(onSave).toHaveBeenCalledWith({ name: 'blog', saveTo: downloads })
  })

  it('does nothing with tab on Same location, which is not a folder, nor on the default', async () => {
    const { app, onMakeDefault } = mount()
    app.stdin.write('\t')
    await settle()
    app.stdin.write(DOWN)
    await settle()
    expect(plain(app)).not.toContain('make default')
    app.stdin.write('\t')
    await settle()
    expect(onMakeDefault).not.toHaveBeenCalled()
  })

  it('fits a narrow terminal', async () => {
    const { app } = mount({ width: 56 })
    await settle()
    expectWhole(plain(app))
    expect(plain(app)).toContain('Save as preset')
    expect(plain(app)).toContain('Ask each time')
  })
})

describe('Save as preset, the folders', () => {
  const DOWNLOADS = join(homedir(), 'Downloads')
  const labels = (d: string) => presetFolders(d).map((f) => f.label)

  it('lists the default once, however it is written', () => {
    expect(labels('~/Desktop')).toEqual(['Desktop', 'Same location', 'Downloads', 'Ask each time'])
    expect(labels(DESKTOP)).toEqual(['Desktop', 'Same location', 'Downloads', 'Ask each time'])
    expect(labels(`${DESKTOP}/`)).toEqual([
      'Desktop',
      'Same location',
      'Downloads',
      'Ask each time',
    ])
    expect(labels(DOWNLOADS)).toEqual(['Downloads', 'Desktop', 'Same location', 'Ask each time'])
  })

  it('keeps the default’s own value, so its row carries the tag', () => {
    expect(presetFolders(DESKTOP)[0]).toEqual({
      label: 'Desktop',
      value: DESKTOP,
      path: '~/Desktop',
    })
  })

  it('leads with a default none of the others cover, named by its last part', () => {
    expect(labels('~/Pictures/Exports')).toEqual([
      'Exports',
      'Desktop',
      'Same location',
      'Downloads',
      'Ask each time',
    ])
  })
})
