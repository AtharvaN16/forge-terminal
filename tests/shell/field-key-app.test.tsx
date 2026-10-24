import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { DARK } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/**
 * Key hints inside a field are chips (2026-10-16). Colour mode's field has none
 * since 2026-10-24: `# new colour` at its end is plain text.
 */

const ESC = String.fromCharCode(27)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

/** The cells of the frame's line holding `text`, and where `text` starts in it. */
function cellsOf(frame: string | undefined, text: string, on: string) {
  const line = (frame ?? '')
    .split('\n')
    .find((l) => plain(l).includes(on) && plain(l).includes(text))
  if (line === undefined) throw new Error(`no line with ${text}`)
  const cells = ansiRow(line)
  const at = cells
    .map((c) => c.ch)
    .join('')
    .indexOf(text)
  return { cells, at }
}

async function onScale() {
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: await makeTempDir() }}
    />,
  )
  await settle()
  app.stdin.write('6')
  await waitFor(() => plain(app.lastFrame()).includes('build a palette'))
  app.stdin.write('s')
  await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
  return app
}

describe('colour mode’s field', () => {
  it('↵ done is a grey chip at its end while a colour is typed (back, 2026-10-24)', async () => {
    const app = await onScale()
    app.stdin.write('#F26E69')
    await waitFor(() => plain(app.lastFrame()).includes('done'))
    const { cells, at } = cellsOf(app.lastFrame(), ' ↵  done', '#F26E69')
    expect(cells[at + 1]).toMatchObject({ ch: '↵', fg: DARK.canvas, bg: DARK.border, b: true })
    expect(cells[at + 4]).toMatchObject({ ch: 'd', fg: DARK.border })
  }, 20_000)

  it('and while two or more are typed for a gradient', async () => {
    const app = await onScale()
    app.stdin.write('#F26E69 → #6579FD → #32A852')
    await waitFor(() => plain(app.lastFrame()).includes('done'))
    const field = plain(app.lastFrame())
      .split('\n')
      .find((l) => l.includes('#F26E69'))
    expect(field).toMatch(/#32A852 .* ↵ {2}done/)
  }, 20_000)

  it('none while the second colour is still to come', async () => {
    const app = await onScale()
    app.stdin.write('#F26E69 → ')
    await settle()
    const field = plain(app.lastFrame())
      .split('\n')
      .find((l) => l.includes('#F26E69'))
    expect(field).not.toContain('done')
    expect(field).toContain('type a second colour to mix')
  }, 20_000)

  it('# new colour at its end once the scale is shown, plain: the key bright, the words quiet', async () => {
    const app = await onScale()
    app.stdin.write('#32A852')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('new colour'))
    expect(plain(app.lastFrame())).not.toContain('gradient to a second colour')
    const { cells, at } = cellsOf(app.lastFrame(), '# new colour', '#32A852')
    expect(cells[at]).toMatchObject({ ch: '#', fg: DARK.fg })
    expect(cells[at + 2]).toMatchObject({ ch: 'n', fg: DARK.border })
    // No chip: the field's own grey behind both.
    expect(cells[at]?.bg).toBe(cells[at - 2]?.bg)
  }, 20_000)
})
