import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

const fake = fakeExtensions()
afterEach(() => fake.restore())

describe('/boost in the shell', () => {
  it('asks 2x or 4x, then writes the image at four times the size and says so', async () => {
    const home = await fake.home()
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'photo.png') // 32 x 32
    const app = render(
      <App
        initialWidth={100}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
      />,
    )
    app.stdin.write('/boost')
    await settle()
    app.stdin.write(ENTER) // arm: the next image goes to /boost
    await until(() => (app.lastFrame() ?? '').includes('Drop an image to boost'))
    app.stdin.write(png)
    await settle()
    app.stdin.write(ENTER) // submit the path
    await until(() => (app.lastFrame() ?? '').includes('twice the width'))
    await settle(400) // let the picker's key handler attach
    app.stdin.write(DOWN) // 2× -> 4×
    await settle(400)
    app.stdin.write(ENTER)
    await settle(500)
    app.stdin.write(ENTER) // first destination preset
    const out = join(dir, 'photo-4x.png')
    await until(() => existsSync(out))
    await until(() => (app.lastFrame() ?? '').includes('boosted 4×'))

    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([128, 128])
    expect(app.lastFrame()).toContain('boosted 4× — photo-4x.png')
  })
})
