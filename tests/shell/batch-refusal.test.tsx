import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const DOWN = `${ESC}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Stages `file`, then drives it through a real, deterministic failure —
 * asking to compress to a target size no actual JPEG can ever reach ("1b")
 * — so the run reports `target-unreachable` and returns to the prompt
 * *without* clearing what was staged. That is the one path in the app that
 * leaves the idle prompt sitting in front of a non-empty stage (see the
 * long comment above `convert()` in App.tsx), which is what makes a second
 * drop actually reachable through the real UI rather than by reaching into
 * React state directly.
 */
async function stageOneThenFailBackToIdle(dir: string, file: string) {
  const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER) // stages the file, lands on the compress "mode" step
  await settle(300)
  app.stdin.write(DOWN) // "To a target size"
  await settle()
  app.stdin.write(ENTER)
  await settle()
  app.stdin.write('1b') // unreachable for any real JPEG
  await settle()
  app.stdin.write(ENTER) // submits the size -> destination step
  await settle()
  app.stdin.write(ENTER) // accepts the default destination -> rename step
  await settle()
  app.stdin.write(ENTER) // accepts the proposed name -> runs the search
  await settle(3000) // up to 8 real encodes of a tiny fixture, plus render
  return app
}

describe('a staged batch refuses to convert or compress', () => {
  it('stages two files, runs /convert, and converts nothing', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')

    const app = await stageOneThenFailBackToIdle(dir, a)
    // Sanity check on the setup itself: the failure has to land back at the
    // prompt with `a.jpg` still staged, not cleared — otherwise the rest of
    // this test would pass for the wrong reason (nothing staged, so of
    // course a second drop does not collide with anything).
    expect(app.lastFrame() ?? '').toContain('a.jpg')

    app.stdin.write(b)
    await settle()
    app.stdin.write(ENTER) // drops b.jpg while a.jpg is still staged
    await settle(300)

    // The staged card itself only renders once past the idle prompt (see
    // App.tsx's render gate), and the refusal deliberately keeps the user
    // at idle — so what proves the batch is really there is the absence of
    // any conversion, checked below, not the card.
    expect(app.lastFrame() ?? '').toContain("isn't supported yet")

    // And explicitly asking, in case some other path had staged the pair —
    // the brief's own wording is "runs /convert".
    app.stdin.write('/convert')
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    expect(app.lastFrame() ?? '').toContain("isn't supported yet")

    const written = (await readdir(dir)).filter((f) => f !== 'a.jpg' && f !== 'b.jpg')
    expect(written).toHaveLength(0)
  }, 20_000)

  it('still converts a single staged file normally — the common case has not moved', async () => {
    const dir = await makeTempDir()
    const solo = await makeJpeg(dir, 'solo.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)
    app.stdin.write(solo)
    await settle()
    app.stdin.write(ENTER) // submit the path -> target picker
    await settle(300)
    app.stdin.write(ENTER) // accept the first offered target
    await settle()
    app.stdin.write(ENTER) // quality (if shown) / destination
    await settle()
    app.stdin.write(ENTER) // destination -> the name step
    await settle()
    app.stdin.write(ENTER) // accept the proposed name
    await settle(600)

    expect(app.lastFrame() ?? '').not.toContain("isn't supported yet")
    const written = (await readdir(dir)).filter((f) => f !== 'solo.jpg')
    expect(written).toHaveLength(1)
  }, 20_000)
})
