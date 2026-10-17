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

/** Key hints inside a field are chips (2026-10-16); in colour mode, grey ones. */

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
  app.stdin.write('5')
  await waitFor(() => plain(app.lastFrame()).includes('build a palette'))
  app.stdin.write('s')
  await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
  return app
}

describe('key hints in colour mode’s field', () => {
  it('↵ done is a grey chip while a colour is typed', async () => {
    const app = await onScale()
    app.stdin.write('#F26E69')
    await waitFor(() => plain(app.lastFrame()).includes('done'))
    const { cells, at } = cellsOf(app.lastFrame(), ' ↵  done', '#F26E69')
    expect(cells[at + 1]).toMatchObject({ ch: '↵', fg: DARK.canvas, bg: DARK.border, b: true })
    expect(cells[at + 4]).toMatchObject({ ch: 'd', fg: DARK.border })
  }, 20_000)

  it('⇧ → gradient is a grey chip once the scale is shown', async () => {
    const app = await onScale()
    app.stdin.write('#32A852')
    await settle()
    app.stdin.write('\r')
    await waitFor(() => plain(app.lastFrame()).includes('gradient to a second colour'))
    const { cells, at } = cellsOf(app.lastFrame(), ' ⇧ →  gradient', '#32A852')
    expect(cells[at + 1]).toMatchObject({ ch: '⇧', fg: DARK.canvas, bg: DARK.border })
    expect(cells[at + 6]).toMatchObject({ ch: 'g', fg: DARK.border })
  }, 20_000)
})
