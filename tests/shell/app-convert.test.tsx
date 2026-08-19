import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

async function driveToResult() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const app = render(<App initialWidth={80} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER) // submit path
  await settle(300)
  app.stdin.write(DOWN + DOWN) // jpeg, png, webp… reach webp. Accepting the
  await settle() // first (jpeg) resolves onto the input itself, which
  app.stdin.write(ENTER) // buildPlan refuses as output-is-input — see
  await settle() // app-safety.test.tsx, which drives exactly that.
  app.stdin.write(ENTER) // accept quality
  await settle()
  app.stdin.write(ENTER) // accept "Same folder"
  await settle(600) // conversion
  return { ...app, dir }
}

describe('shell conversion', () => {
  it('converts and writes the file', async () => {
    const { dir } = await driveToResult()
    expect(existsSync(join(dir, 'photo.webp'))).toBe(true)
  })

  it('shows the result with both sizes and the change', async () => {
    const { lastFrame } = await driveToResult()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✓')
    expect(frame).toContain('photo.webp')
    expect(frame).toMatch(/smaller|larger|same size/)
  })

  it('offers the result keybindings', async () => {
    const { lastFrame } = await driveToResult()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('convert another')
    expect(frame).toContain('open')
    expect(frame).toContain('reveal')
  })

  it('returns to the prompt on enter so you can convert another', async () => {
    const { stdin, lastFrame } = await driveToResult()
    stdin.write(ENTER)
    await settle()
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })

  it('keeps the previous result in history after converting another', async () => {
    const { stdin, lastFrame } = await driveToResult()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('photo.webp')
  })

  /**
   * Two Enters in the same tick — a held key repeating, or a paste carrying
   * two line endings — both reach `convert` before React re-renders, because
   * `useInput` handlers run synchronously between renders and unmounting the
   * destination step only takes effect on the next one. Measured before the
   * guard: two `runJobs` calls, two encodes, two renames onto the same path,
   * two result blocks.
   *
   * Deliberately two separate synchronous `write` calls with no `settle`
   * between them — that is the only way both land on the same mounted
   * handler. A yield in between lets React unmount it, and the second write
   * hits nothing, which proves nothing.
   */
  it('starts exactly one conversion when two Enters arrive in the same tick', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const app = render(<App initialWidth={80} />)
    app.stdin.write(jpg)
    await settle()
    app.stdin.write(ENTER) // submit path
    await settle(300)
    app.stdin.write(DOWN + DOWN) // webp
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(ENTER) // quality
    await settle()
    app.stdin.write(ENTER) // "Same folder"
    app.stdin.write(ENTER) // …and again, same tick
    await settle(900)
    const frame = app.lastFrame() ?? ''
    expect(frame.split('✓').length - 1).toBe(1)
  })

  /**
   * Result blocks stay in `<Static>` scrollback for the rest of the session,
   * so `f` and `o` remain pressable long after the file they point at has
   * been moved, renamed, or had its volume unmounted. `reveal.ts` promisifies
   * `execFile`, so `open` exiting non-zero rejects — and a `void`ed rejection
   * is an unhandled rejection, which terminates Node and prints the whole
   * stack. Spec §11: no raw stack trace without `--debug`, and the shell has
   * no `--debug`.
   */
  it('reports a failed open as an error block instead of dying on it', async () => {
    const { stdin, lastFrame, dir } = await driveToResult()
    await rm(join(dir, 'photo.webp'))
    stdin.write('f')
    await settle(1500)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✕')
    expect(frame).toContain('convert another') // still alive, still on the result stage
  })

  it('reports a failed reveal the same way', async () => {
    const { stdin, lastFrame, dir } = await driveToResult()
    await rm(join(dir, 'photo.webp'))
    stdin.write('o')
    await settle(1500)
    expect(lastFrame()).toContain('✕')
  })
})
