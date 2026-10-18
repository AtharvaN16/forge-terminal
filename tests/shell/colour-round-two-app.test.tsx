import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeTempDir } from '../helpers/fixtures.js'

/** Colour, round two (colour spec §12), through the whole app at 80 × 24. */

const ESC = String.fromCharCode(27)
const RIGHT = `${ESC}[C`
const SHIFT_RIGHT = `${ESC}[1;2C`
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

async function colourHome(height = 24) {
  const dir = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={height}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  await settle()
  app.stdin.write('6')
  await waitFor(() => plain(app.lastFrame()).includes('build a palette'))
  await settle()
  return app
}

describe('colour, round two, in the app', () => {
  it('home has three cards; the third opens Palette, which a colour fills', async () => {
    const app = await colourHome()
    expect(plain(app.lastFrame())).toMatch(/A Extract +S Scale +D Palette/)
    app.stdin.write('d')
    await waitFor(() =>
      plain(app.lastFrame()).includes('type a hex, rgb(), hsl(), oklch() or a colour name'),
    )
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
    app.stdin.write('s')
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

  it('a blank row between the field and Scale’s tabs, where the window has one to spare', async () => {
    for (const height of [24, 30]) {
      const app = await colourHome(height)
      app.stdin.write('s')
      await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
      app.stdin.write('#6579FD')
      await settle()
      app.stdin.write('\r')
      await waitFor(() => plain(app.lastFrame()).includes('tab  switch'))
      const all = lines(app.lastFrame())
      const tabs = all.findIndex((l) => l.includes('tab  switch'))
      // The field is three rows, its last blank: under it, a blank row or the tabs.
      const blanks = tabs - all.findIndex((l) => l.includes('› #6579FD')) - 1
      expect(blanks, `${height} rows`).toBe(height === 24 ? 1 : 2)
      expect(all, `${height} rows`).toHaveLength(height)
      app.unmount()
    }
  }, 30_000)

  it('⇧→ after a colour asks for a second; ↵ mixes them', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#F26E69')
    await settle()
    // A whole colour typed: the field's far end says ↵ is done. The
    // gradient's helper waits until it is (⇧→ works all the same).
    expect(plain(app.lastFrame())).toMatch(/#F26E69 .* ↵ {2}done/)
    expect(plain(app.lastFrame())).not.toContain('gradient to a second colour')
    app.stdin.write(SHIFT_RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('type a second colour to mix'))
    expect(plain(app.lastFrame())).not.toContain('gradient to a second colour')
    app.stdin.write('#6579FD')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('straight across'))
    expect(plain(app.lastFrame())).toMatch(/#F26E69 ╱ Mix/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('⇧→ still starts a gradient once the scale is shown, and the field says so', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#32A852')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('tab  switch'))
    expect(plain(app.lastFrame())).toMatch(/#32A852 .* ⇧ → {2}gradient to a second colour/)
    // → alone still walks the ramp.
    app.stdin.write(RIGHT)
    await settle()
    expect(plain(app.lastFrame())).not.toContain('type a second colour to mix')
    app.stdin.write(SHIFT_RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('type a second colour to mix'))
    app.stdin.write('#6579FD')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('straight across'))
    expect(plain(app.lastFrame())).toMatch(/╱ Mix/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('t on a scale opens Tweak over it; ↵ keeps the scale moved', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#32A852')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('tab  switch'))
    const before = plain(app.lastFrame())
    expect(before).toMatch(/t +tweak +s +steps/)
    app.stdin.write('t')
    await waitFor(() => plain(app.lastFrame()).includes('Tweak'))
    expect(plain(app.lastFrame())).toMatch(/brightness/)
    expect(keyRow(app.lastFrame())).toMatch(/⇧←→ +10/)
    app.stdin.write(SHIFT_RIGHT)
    await settle()
    app.stdin.write('\r')
    await waitFor(() => !plain(app.lastFrame()).includes('brightness'))
    // The scale is lighter: the centre step's hex is another.
    expect(plain(app.lastFrame())).not.toContain('500  #32A852')
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('wrong input can be corrected in place: backspace, then a colour, then ↵', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('z')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('wrong input'))
    app.stdin.write('\x7f')
    await settle()
    expect(plain(app.lastFrame())).not.toContain('wrong input')
    app.stdin.write('crimson')
    await settle()
    expect(plain(app.lastFrame())).toMatch(/› crimson/)
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('tab  switch'))
    expect(plain(app.lastFrame())).toContain('#DC143C')
  }, 30_000)

  it('→ moves the cursor; only ⇧→ at the end asks for a second', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#ff0000')
    await settle()
    app.stdin.write(`${ESC}[D`)
    await settle(100)
    app.stdin.write(`${ESC}[D`)
    await settle(100)
    app.stdin.write(RIGHT)
    await settle()
    // No arrow put after the colour (the far end's hint has one of its own).
    expect(plain(app.lastFrame())).not.toMatch(/#ff0000 →/)
    // At the end now: → alone still asks for nothing, it is the ramp's key.
    app.stdin.write(RIGHT)
    await settle()
    app.stdin.write(RIGHT)
    await settle()
    expect(plain(app.lastFrame())).not.toMatch(/#ff0000 →/)
    app.stdin.write(SHIFT_RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('type a second colour to mix'))
  }, 30_000)

  it('typing a new colour over a tabbed scale keeps the screen at 24 rows', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#6579FD')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('tab  switch'))
    app.stdin.write('\t')
    await settle()
    app.stdin.write('\t')
    await settle()
    app.stdin.write('#F26E69')
    await settle()
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('s on Palette shows the steps line in the mode line’s place', async () => {
    const app = await colourHome()
    app.stdin.write('d')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#D2042D')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('Full set'))
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('‹ Tailwind ›'))
    expect(plain(app.lastFrame())).toMatch(/↵ +done/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)
})
