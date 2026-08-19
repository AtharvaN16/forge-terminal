import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const LEFT = `${ESC}[D`
const ENTER = String.fromCharCode(13)
const CTRL_U = String.fromCharCode(21)
const settle = (ms = 180) => new Promise((r) => setTimeout(r, ms))

/**
 * The caret is drawn with reverse video, which emits nothing when chalk has
 * colour off — and chalk decides that once, at import. Without this the caret
 * is textually invisible and "did it move?" cannot be asked at all.
 */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR is the point
const ANSI = /\[[0-9;]*m/g
const plain = (f: string | undefined) => (f ?? '').replace(ANSI, '')

/**
 * Walks to the name field: drop a file, pick webp, accept quality, accept a
 * destination. Naming is a step in the flow, not an alternative to saving —
 * choosing where a file goes and choosing what it is called are not a choice
 * between two things.
 */
async function toRename() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={80} prefs={prefs} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write(DOWN) // png, webp, avif — one down reaches webp, which is lossy
  await settle()
  app.stdin.write(ENTER)
  await settle()
  app.stdin.write(ENTER) // accept quality
  await settle()
  app.stdin.write(ENTER) // accept the destination -> the name step
  await settle(250)
  return { ...app, dir }
}

describe('rename field', () => {
  it('opens pre-filled with the current name', async () => {
    const { lastFrame } = await toRename()
    expect(plain(lastFrame())).toContain('Name the file')
    expect(plain(lastFrame())).toContain('photo')
  })

  it('appends what you type instead of inserting it at the front', async () => {
    // The bug this pins: the caret sat at 0 when the parent seeded the field,
    // so typing "XY" into "photo" produced "XYphoto".
    const { stdin, lastFrame } = await toRename()
    stdin.write('XY')
    await settle()
    const line = plain(lastFrame())
      .split('\n')
      .find((l) => l.trimStart().startsWith('›'))
    expect(line).toContain('photoXY')
    expect(line).not.toContain('XYphoto')
  })

  it('ctrl-u clears the field', async () => {
    const { stdin, lastFrame } = await toRename()
    stdin.write('somename')
    await settle()
    stdin.write(CTRL_U)
    await settle()
    const line = plain(lastFrame())
      .split('\n')
      .find((l) => l.trimStart().startsWith('›'))
    expect(line).not.toContain('somename')
  })

  it('a left arrow moves the caret on screen, not only in state', async () => {
    const { stdin, lastFrame } = await toRename()
    stdin.write('ab')
    await settle()
    const before = lastFrame() ?? ''
    stdin.write(LEFT)
    await settle()
    // Nothing about the text changed, so a frame identical to the previous one
    // means the caret moved in the ref and never on screen — which is exactly
    // what made the arrows feel dead.
    expect(lastFrame()).not.toBe(before)
  })

  it('typing after a left arrow inserts at the caret', async () => {
    const { stdin, lastFrame } = await toRename()
    stdin.write(CTRL_U)
    await settle()
    stdin.write('ac')
    await settle()
    stdin.write(LEFT)
    await settle()
    stdin.write('b')
    await settle()
    const line = plain(lastFrame())
      .split('\n')
      .find((l) => l.trimStart().startsWith('›'))
    expect(line).toContain('abc')
  })

  it('shows the resolved output path as you type', async () => {
    const { stdin, lastFrame } = await toRename()
    stdin.write(CTRL_U)
    await settle()
    stdin.write('renamed')
    await settle()
    expect(plain(lastFrame())).toContain('renamed.webp')
  })
})

describe('hint bar', () => {
  it('draws exactly one rule above the hints', async () => {
    const { lastFrame } = await toRename()
    const rules = plain(lastFrame())
      .split('\n')
      .filter((l) => /^─+$/.test(l.trim()))
    expect(rules.length).toBe(1)
  })
})
