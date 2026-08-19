import { existsSync } from 'node:fs'
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
  app.stdin.write(DOWN + DOWN) // jpeg, png, webp… reach webp. Accepting the first
  await settle() // (jpeg) would write photo.jpg over the input and
  app.stdin.write(ENTER) // fail as output-is-input.
  await settle()
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
})
