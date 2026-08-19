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

/** Enter four times from a dropped JPEG: first target (jpeg), quality, first preset (Same folder). */
async function allDefaults() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const app = render(<App initialWidth={80} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER) // submit the path
  await settle(300)
  app.stdin.write(ENTER) // accept the first target — jpeg, the source's own format
  await settle()
  app.stdin.write(ENTER) // accept the default quality
  await settle()
  app.stdin.write(ENTER) // accept the first preset — "Same folder"
  await settle(600)
  return { ...app, dir, jpg }
}

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
  app.stdin.write(DOWN + DOWN) // jpeg, png, webp
  await settle()
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
    app.stdin.write(ENTER)
    await settle(300)
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(ENTER)
    await settle(600)
    const after = await readFile(jpg)
    expect(after.equals(before)).toBe(true)
  })

  it('says so, and never reports the overwrite as a success', async () => {
    const { lastFrame } = await allDefaults()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Output would replace the original')
    expect(frame).not.toContain('✓')
  })

  it('returns to the destination step so a different folder can be picked', async () => {
    const { lastFrame } = await allDefaults()
    expect(lastFrame()).toContain('Save to')
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
