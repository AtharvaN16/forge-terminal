import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

/**
 * Spec §8 has two write-safety rules, and both of them live in
 * `buildPlan()` — the shell has to route through it or it has neither.
 * These drive the real keypaths that reach them.
 */

/** Same walk, but to webp with a webp already sitting in the destination. */
async function ontoAnExistingOutput() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const existing = join(dir, 'photo.webp')
  await writeFile(existing, 'not really a webp, but it is in the way')
  const app = render(<App initialWidth={80} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER)
  await settle(300)
  app.stdin.write(DOWN) // jpeg is excluded (same-format is a no-op), so
  await settle() // targets are png, webp, avif… one DOWN reaches webp.

  app.stdin.write(ENTER)
  await settle()
  app.stdin.write(ENTER) // quality
  await settle()
  app.stdin.write(ENTER) // "Same folder"
  await settle(400)
  return { ...app, dir, existing }
}

describe('the shell never writes over the input', () => {
  it('leaves the original byte-identical on the all-defaults keypath', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const before = await readFile(jpg)
    const app = render(<App initialWidth={80} />)
    app.stdin.write(jpg)
    await settle()
    app.stdin.write(ENTER) // submit the path
    await settle(300)
    app.stdin.write(ENTER) // accept the first offered target — never jpeg,
    await settle() // since converting to your own format isn't offered
    app.stdin.write(ENTER) // accept the default quality
    await settle()
    app.stdin.write(ENTER) // accept the first preset — "Same folder"
    await settle(600)
    const after = await readFile(jpg)
    expect(after.equals(before)).toBe(true)
  })

  /**
   * `buildPlan()`'s `output-is-input` refusal (unit-tested directly at
   * tests/core/plan.test.ts:54) used to be reachable through the shell by
   * accepting every default: the first offered target was the source's own
   * format, so "photo.jpg" would convert to "photo.jpg" and only that
   * refusal stood between accepting every default and silent data loss.
   *
   * The target picker now excludes the source's own format outright (see
   * targetSelect in core/actions.ts) — the dangerous choice is never
   * offered, which is stronger than refusing it after the fact. That also
   * means the refusal is no longer reachable through the picker at all.
   * `buildPlan()`'s check stays wired into `convert()` regardless, as a
   * backstop the type system doesn't otherwise guarantee: a future change
   * that reintroduces a same-format choice (a "recompress" action, say)
   * would still be caught here rather than writing over the user's file.
   */
  it("never offers the source's own format, so the collision can't be reached", async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    // 'JPEG' appears twice — the file card and the "Convert JPEG to" label —
    // and never a third time as its own row in the picker below.
    expect((lastFrame() ?? '').split('JPEG').length - 1).toBe(2)
  })
})

describe('an existing output is a question, not a silent overwrite', () => {
  it('offers keep both, replace and cancel', async () => {
    const { lastFrame } = await ontoAnExistingOutput()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('already exists')
    expect(frame).toContain('Keep both')
    expect(frame).toContain('Replace')
    expect(frame).toContain('Cancel')
  })

  it('keeps both: writes a suffixed file and leaves the existing one untouched', async () => {
    const { stdin, dir, existing } = await ontoAnExistingOutput()
    const before = await readFile(existing)
    stdin.write(ENTER) // "Keep both" is first
    await settle(700)
    expect(existsSync(join(dir, 'photo (1).webp'))).toBe(true)
    expect((await readFile(existing)).equals(before)).toBe(true)
  })

  it('replaces: overwrites the existing file', async () => {
    const { stdin, existing } = await ontoAnExistingOutput()
    const before = await readFile(existing)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(700)
    expect((await readFile(existing)).equals(before)).toBe(false)
  })

  it('cancels: writes nothing and comes back to the destination step', async () => {
    const { stdin, lastFrame, dir, existing } = await ontoAnExistingOutput()
    const before = await readFile(existing)
    stdin.write(DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect((await readFile(existing)).equals(before)).toBe(true)
    expect(existsSync(join(dir, 'photo (1).webp'))).toBe(false)
    expect(lastFrame()).toContain('Save to')
  })
})
