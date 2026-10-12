import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const CTRL_N = String.fromCharCode(14)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => plain(f).split('\n')
const keyRow = (f: string | undefined) => lines(f).findLast((l) => l.trim() !== '') ?? ''
const tabRow = (f: string | undefined) => lines(f).find((l) => l.includes('/ commands')) ?? ''

async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

async function home() {
  const dir = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  await settle()
  return { app, dir }
}

describe('colour, the fourth mode', () => {
  it('4 on home makes colour the mode; results go to the clipboard', async () => {
    const { app } = await home()
    expect(tabRow(app.lastFrame())).toContain('4 colour')
    expect(keyRow(app.lastFrame())).toMatch(/1–4 +mode/)
    app.stdin.write('4')
    await waitFor(() => tabRow(app.lastFrame()).includes('clipboard'))
    expect(tabRow(app.lastFrame())).toContain('clipboard')
  }, 20_000)

  it('4 on a picker switches to colour, and ctrl-n goes back to convert', async () => {
    const { app, dir } = await home()
    app.stdin.write(await makeGradientPng(dir, 'a.png', 32))
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => plain(app.lastFrame()).includes('Convert PNG to'))
    await settle(300) // the picker's keys attach after its first frame
    expect(keyRow(app.lastFrame())).toMatch(/1–4 +mode/)
    app.stdin.write('4')
    await waitFor(() => tabRow(app.lastFrame()).includes('clipboard'))
    expect(tabRow(app.lastFrame())).toContain('clipboard')
    app.stdin.write(CTRL_N)
    await waitFor(
      () =>
        tabRow(app.lastFrame()).includes('~/') || !tabRow(app.lastFrame()).includes('clipboard'),
    )
    expect(tabRow(app.lastFrame())).not.toContain('clipboard')
  }, 20_000)
})
