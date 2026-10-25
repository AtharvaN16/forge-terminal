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
    // The mode's name on More's row, over the rule (2026-10-24); a blank
    // between the chosen swatch's line and the step numbers.
    expect(plain(frame)).toMatch(/ {2}Full set +m {2}more\s*\n/)
    const all = lines(frame)
    const chosen = all.findIndex((l) => /red 500 {2}#F7022A/.test(l))
    expect(all[chosen + 1]?.trim()).toBe('')
    expect(all[chosen + 2]).toMatch(/50 +100 +200/)
    expect(
      all
        .slice(chosen + 1)
        .filter((l) =>
          /^ {2}(red|orange|yellow|green|teal|blue|purple|pink|neutral)\b/.test(l.slice(2)),
        ),
    ).toHaveLength(9)
    expect(lines(frame)).toHaveLength(24)

    app.stdin.write('m')
    await waitFor(() => plain(app.lastFrame()).includes('╭─ More'))
    expect(plain(app.lastFrame())).toMatch(/❯ Mode/)
    expect(keyRow(app.lastFrame())).toMatch(/↑↓ +choose +↵ +open +m +done/)
    expect(lines(app.lastFrame())).toHaveLength(24)
    app.stdin.write('\r')
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

  it('Scale’s four tabs each fit the window; wrong input turns up in the box', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#6579FD')
    await settle()
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
    for (const tab of ['Colour', 'Neutral', 'Alpha', 'Palette']) {
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
      await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
      const all = lines(app.lastFrame())
      const tabs = all.findIndex((l) => /Colour +Neutral +Alpha +Palette/.test(l))
      // The field is three rows, its last blank: under it, a blank row or the tabs.
      const blanks = tabs - all.findIndex((l) => l.includes('› #6579FD')) - 1
      expect(blanks, `${height} rows`).toBe(height === 24 ? 1 : 2)
      expect(all, `${height} rows`).toHaveLength(height)
      app.unmount()
    }
  }, 30_000)

  it('a name waits for ↵, and ⇧→ after it asks for a second colour; ↵ makes the gradient', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('crimson')
    await settle()
    // Whole, but it could grow: ↵ done at the field's end, and on the key row.
    const field = lines(app.lastFrame()).find((l) => l.includes('crimson')) ?? ''
    expect(field).toMatch(/crimson .* ↵ {2}done/)
    expect(keyRow(app.lastFrame())).toMatch(/↵ +done/)
    app.stdin.write(SHIFT_RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('type a second colour to mix'))
    expect(plain(app.lastFrame())).not.toContain('gradient to a second colour')
    app.stdin.write('#6579FD')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('straight across'))
    expect(plain(app.lastFrame())).toMatch(/#DC143C ╱ Gradient/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('six hex digits go on by themselves: the scale is there at once, with no ↵ to press (2026-10-24)', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#F26E69')
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
    expect(plain(app.lastFrame())).toMatch(/Colour +Neutral +Alpha +Palette/)
    expect(lines(app.lastFrame()).find((l) => l.includes('› #F26E69'))).not.toContain('done')
    expect(keyRow(app.lastFrame())).toMatch(/←→ +choose +↵ +copy/)
  }, 30_000)

  it('once the scale is shown, ⇧→ opens the Gradient window; three colours make a gradient', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#32A852')
    await settle()
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
    expect(plain(app.lastFrame())).toMatch(/#32A852 .* # new colour/)
    // → alone still walks the ramp.
    app.stdin.write(RIGHT)
    await settle()
    expect(plain(app.lastFrame())).not.toContain('Gradient')
    app.stdin.write(SHIFT_RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes('╭─ Gradient'))
    expect(keyRow(app.lastFrame())).toMatch(/↵ +add +↑↓ +choose .*tab done · esc cancel/)
    for (const c of ['#6579FD', '#F5A524']) {
      app.stdin.write(c)
      await settle()
      app.stdin.write('\r')
      await settle()
    }
    expect(plain(app.lastFrame())).toMatch(/3 +#F5A524/)
    expect(lines(app.lastFrame())).toHaveLength(24)
    app.stdin.write('\t')
    await waitFor(() => plain(app.lastFrame()).includes('straight across'))
    expect(plain(app.lastFrame())).toMatch(/╱ Gradient/)
    expect(plain(app.lastFrame())).toMatch(/#32A852 .*→ .*#6579FD .*→ .*#F5A524/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('t on a scale opens Tweak over it; ↵ keeps the scale moved', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#32A852')
    await settle()
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
    // t still opens Tweak at once; More lists it too.
    expect(plain(app.lastFrame())).toMatch(/ m {2}more/)
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
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
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
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
    app.stdin.write('\t')
    await settle()
    app.stdin.write('\t')
    await settle()
    app.stdin.write('#F26E69')
    await settle()
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)

  it('the Palette tab fits the window and shows every row at 24, 26, 30 and 40 rows (2026-10-24)', async () => {
    for (const height of [24, 26, 30, 40]) {
      const app = await colourHome(height)
      app.stdin.write('d')
      await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
      app.stdin.write('#6579FD')
      await settle()
      await waitFor(() => plain(app.lastFrame()).includes('Full set'))
      const all = lines(app.lastFrame())
      expect(all, `${height} rows`).toHaveLength(height)
      for (const name of [
        'red',
        'orange',
        'yellow',
        'green',
        'teal',
        'blue',
        'purple',
        'pink',
        'neutral',
      ]) {
        expect(
          all.some((l) => new RegExp(`^ *${name}( |$)`).test(l)),
          `${height}: ${name}`,
        ).toBe(true)
      }
      app.unmount()
    }
  }, 60_000)

  it('a copy says so in place of the key row, then the keys come back', async () => {
    const app = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#6579FD')
    await settle()
    await waitFor(() => plain(app.lastFrame()).includes('# new colour'))
    app.stdin.write('c')
    await waitFor(() => keyRow(app.lastFrame()).includes('copied'))
    expect(keyRow(app.lastFrame())).toMatch(
      /✓ copied 11 swatches · paste into Figma with (⌘V|Ctrl\+V)/,
    )
    expect(lines(app.lastFrame())).toHaveLength(24)
    await waitFor(() => keyRow(app.lastFrame()).includes('choose'), 5000)
    expect(keyRow(app.lastFrame())).toMatch(/←→ +choose/)
  }, 30_000)

  it('s on Palette shows the steps line in the mode line’s place', async () => {
    const app = await colourHome()
    app.stdin.write('d')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('#D2042D')
    await settle()
    await waitFor(() => plain(app.lastFrame()).includes('Full set'))
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('‹ Tailwind ›'))
    expect(plain(app.lastFrame())).toMatch(/‹ Tailwind ›.* tab +↵ +done\s*\n/)
    expect(lines(app.lastFrame())).toHaveLength(24)
  }, 30_000)
})
