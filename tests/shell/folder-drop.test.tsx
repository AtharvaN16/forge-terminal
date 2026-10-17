import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

async function drop(path: string, mode?: string) {
  const app = render(<App initialWidth={100} initialHeight={30} prefs={prefsFor(path)} />)
  if (mode) {
    await settle()
    app.stdin.write(mode)
    await settle()
  }
  app.stdin.write(path)
  await settle()
  app.stdin.write(ENTER)
  await settle(500)
  return app
}

/**
 * Phase 3 §4: the prompt accepts a directory, and it resolves through
 * `resolve.ts` like the CLI's. It used to be probed as one file and refused
 * as "Not a file", with a hint — written for the CLI — recommending a
 * directory of images (UX audit #11).
 */
describe('dropping a folder', () => {
  it('in /pdf, stages a folder of PDFs as a merge list', async () => {
    const dir = join(await makeTempDir(), 'invoices')
    await mkdir(dir)
    await makePdf(dir, 'jan.pdf', 2)
    await makePdf(dir, 'feb.pdf', 3)

    const frame = (await drop(dir, '3')).lastFrame() ?? ''
    expect(frame).toContain('jan.pdf')
    expect(frame).toContain('feb.pdf')
    expect(frame).not.toContain('Not a file')
  }, 20_000)

  /**
   * forge watch (mockups/watch-2026-10.html): in convert mode a folder is
   * one thing, its card, and ↵ asks for the folder as a whole.
   */
  it('in convert mode, asks for the folder as a whole', async () => {
    const dir = join(await makeTempDir(), 'invoices')
    await mkdir(dir)
    await makePdf(dir, 'jan.pdf', 2)
    await makePdf(dir, 'feb.pdf', 3)

    const frame = (await drop(dir)).lastFrame() ?? ''
    expect(frame).toContain('FOLDER – invoices')
    expect(frame).toMatch(/Convert to\s+2 PDFs/)
    expect(frame).not.toContain('Not a file')
  }, 20_000)

  it('a folder holding one image is still the folder in convert mode', async () => {
    const dir = join(await makeTempDir(), 'one')
    await mkdir(dir)
    await makeJpeg(dir, 'photo.jpg')

    const app = await drop(`${dir}/`)
    expect(app.lastFrame() ?? '').toContain('FOLDER – one')
    expect(app.lastFrame() ?? '').toContain('1 image · ')
    app.stdin.write(ENTER)
    await settle(500)
    expect(app.lastFrame() ?? '').toMatch(/Convert to\s+1 image/)
  }, 20_000)

  it('says an empty folder holds nothing, without CLI flags in the hint', async () => {
    const dir = join(await makeTempDir(), 'empty')
    await mkdir(dir)

    const frame = (await drop(dir)).lastFrame() ?? ''
    expect(frame).toContain('empty contains no')
    expect(frame).not.toContain('left out')
    expect(frame).not.toContain('--recursive')
    expect(frame).not.toContain('Not a file')
  }, 20_000)
})
