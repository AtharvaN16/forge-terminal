import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

describe('several files at once', () => {
  it('still refuses /convert on a staged merge list rather than converting one of it', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 2)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    // Both at once, the way a real drag of two files pastes them.
    app.stdin.write(`${a} ${b}`)
    await settle(400)
    expect(app.lastFrame() ?? '').toContain('2 PDFs')

    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').toContain("isn't supported yet")

    const written = (await readdir(dir)).filter((f) => f !== 'jan.pdf' && f !== 'feb.pdf')
    expect(written).toHaveLength(0)
  }, 20_000)

  /**
   * Dropping a second PDF is the only way to build a merge stage. A PDF has a
   * real convert target, so ↵ on the first drop opens that picker; esc backs
   * out of it keeping the stage (`backToPromptKeepingStage`), landing on home
   * with the card, and the second drop joins it there — a list, with the note
   * that says where several PDFs can go today.
   */
  it('stages two PDFs, shows them, and points at /pdf to merge them', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'jan.pdf', 3)
    const b = await makePdf(dir, 'feb.pdf', 2)
    const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)

    app.stdin.write(a)
    await settle(400)
    app.stdin.write(ENTER)
    await settle(400) // opens the convert picker for jan.pdf
    app.stdin.write(ESC)
    await settle(300) // back to home, jan.pdf still staged
    app.stdin.write(b)
    await settle(400)

    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('2 PDFs')
    expect(frame).toContain('jan.pdf')
    expect(frame).toContain('feb.pdf')
    expect(frame).toContain('/pdf merges them')
    expect(frame).not.toContain("isn't supported yet")
  }, 20_000)

  it('still converts a single staged file normally — the common case has not moved', async () => {
    const dir = await makeTempDir()
    const solo = await makeJpeg(dir, 'solo.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
    // Each step waits for its screen, then a beat: its key handler attaches just after.
    const reach = async (text: string) => {
      const start = Date.now()
      const shown = () => (app.lastFrame() ?? '').replace(SGR, '').includes(text)
      while (!shown() && Date.now() - start < 10_000) await settle(30)
      await settle(100)
    }
    app.stdin.write(solo)
    await settle()
    app.stdin.write(ENTER) // submit the path -> target picker
    await reach('Convert to')
    app.stdin.write(ENTER) // the first offered target: PNG, lossless, so no quality
    await reach('Save as')
    app.stdin.write(ENTER) // Save as: the proposed name, in the default folder
    await reach('convert another')

    expect(app.lastFrame() ?? '').not.toContain("isn't supported yet")
    const written = (await readdir(dir)).filter((f) => f !== 'solo.jpg')
    expect(written).toHaveLength(1)
  }, 20_000)
})
