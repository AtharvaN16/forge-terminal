import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeTempDir } from '../helpers/fixtures.js'

/** Colour, round two (colour spec §12), through the whole app at 80 × 24. */

const ESC = String.fromCharCode(27)
const RIGHT = `${ESC}[C`
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => plain(f).split('\n')
const keyRow = (f: string | undefined) => lines(f).findLast((l) => l.trim() !== '') ?? ''

async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

async function colourHome() {
  const dir = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  await settle()
  app.stdin.write('5')
  await waitFor(() => plain(app.lastFrame()).includes('build a palette'))
  await settle()
  return app
}

describe('colour, round two, in the app', () => {
  it('home has three cards; the third opens Palette, which a colour fills', async () => {
    const app = await colourHome()
    expect(plain(app.lastFrame())).toMatch(/Extract +Scale +Palette/)
    app.stdin.write(RIGHT)
    await settle(150)
    app.stdin.write(RIGHT)
    await settle(150)
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex, rgb(), hsl(), oklch() or a colour name'))
    app.stdin.write('cherry red')
    await waitFor(() => plain(app.lastFrame()).includes('#F7022A'))
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('Full set'))
    const frame = app.lastFrame()
    expect(plain(frame)).toMatch(/red 500 {2}#F7022A/)
    expect(plain(frame)).toMatch(/Full set +m +mode +t +tweak +s +steps/)
    expect(lines(frame)).toHaveLength(24)

    app.stdin.write('m')
    await waitFor(() => plain(app.lastFrame()).includes('╭─ Mode'))
    expect(plain(app.lastFrame())).toContain('Split complementary')
    expect(lines(app.lastFrame())).toHaveLength(24)
    for (let i = 0; i < 3; i++) {
      app.stdin.write(DOWN)
      await settle(100)
    }
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('Complementary  '))
    expect(plain(app.lastFrame())).not.toContain('╭─ Mode')

    app.stdin.write('t')
    await waitFor(() => plain(app.lastFrame()).includes('╭─ Tweak'))
    expect(keyRow(app.lastFrame())).toMatch(/↑↓ +choose +←→ +1 +⇧←→ +10 +↵ +done/)
    expect(lines(app.lastFrame())).toHaveLength(24)
    app.stdin.write(RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('+1'))
    app.stdin.write('\r')
    await waitFor(() => !plain(app.lastFrame()).includes('╭─ Tweak'))
    expect(keyRow(app.lastFrame())).toContain('r reset')
  }, 30_000)

  it('Scale’s three tabs each fit the window; wrong input turns up in the box', async () => {
    const app = await colourHome()
    app.stdin.write(RIGHT)
    await settle(150)
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#6579FD')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('tab  switch'))
    for (const tab of ['Colour', 'Neutral', 'Alpha']) {
      expect(lines(app.lastFrame()), tab).toHaveLength(24)
      app.stdin.write('\t')
      await settle(200)
    }
    app.stdin.write('#')
    await settle()
    app.stdin.write('rgb(300 0 0)')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('wrong input'))
    expect(plain(app.lastFrame())).toMatch(/rgb\(300 0 0\) +wrong input/)
  }, 30_000)

  it('→ after a colour asks for a second; ↵ mixes them', async () => {
    const app = await colourHome()
    app.stdin.write(RIGHT)
    await settle(150)
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#F26E69')
    await settle()
    app.stdin.write(RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('type a second colour to mix'))
    app.stdin.write('#6579FD')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('straight across'))
    expect(plain(app.lastFrame())).toMatch(/#F26E69 ╱ Mix/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)
})
