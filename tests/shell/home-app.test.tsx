import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const TAB = '\t'
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

function home(dir: string) {
  return render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
}

/** The completion row with the ▌ strip, or '' when none is chosen. */
const chosenLine = (frame: string) => frame.split('\n').find((l) => l.includes('▌ ')) ?? ''

/** The line the field is drawn on. */
const fieldLine = (frame: string) => frame.split('\n').find((l) => l.startsWith('    › ')) ?? ''

describe('the home screen in the app', () => {
  it('is what an empty prompt shows, filling the terminal', async () => {
    const app = home(await makeTempDir())
    await settle()
    const frame = plain(app.lastFrame())
    expect(frame.split('\n')).toHaveLength(24)
    expect(frame).toContain('Drop a file here')
    expect(frame).toContain('1 convert')
    expect(fieldLine(frame)).toBe('    › or type a path')
    expect(frame.split('\n').at(-1)).toContain('commands')
    // The old banner's mode line is gone with it.
    expect(frame).not.toContain('current mode')
  })

  it('switches mode with 1–3 while the field is empty', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('2')
    await settle()
    let frame = plain(app.lastFrame())
    expect(frame).toContain('images · PDF')
    expect(fieldLine(frame)).toBe('    › or type a path')

    app.stdin.write('3')
    await settle()
    frame = plain(app.lastFrame())
    expect(frame).toContain('split · merge · rotate')

    app.stdin.write('1')
    await settle()
    expect(plain(app.lastFrame())).toContain('images · HEIC · PDF · Word')
  })

  it('types digits once there is text in the field', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('~/')
    await settle()
    app.stdin.write('2')
    await settle()
    expect(fieldLine(plain(app.lastFrame()))).toContain('~/2')
  })

  it('lists completions under the field and Tab takes the chosen one', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'alpha.png')
    await makePng(dir, 'beta.png')
    await writeFile(join(dir, 'notes.txt'), 'not something forge reads')
    const app = home(dir)
    await settle()

    app.stdin.write(`${dir}/`)
    await settle(300)
    let frame = plain(app.lastFrame())
    // The folder is a long temp path, shortened in the middle; the names are
    // what tell the rows apart.
    expect(chosenLine(frame)).toMatch(/alpha\.png\s*$/)
    expect(frame).toMatch(/beta\.png/)
    expect(frame).not.toContain('notes.txt')
    expect(frame.split('\n').at(-1)).toMatch(/tab +complete/)

    app.stdin.write(DOWN)
    await settle()
    expect(chosenLine(plain(app.lastFrame()))).toMatch(/beta\.png\s*$/)
    app.stdin.write(UP)
    await settle()
    app.stdin.write(DOWN)
    await settle()

    app.stdin.write(TAB)
    await settle(300)
    frame = plain(app.lastFrame())
    // The field wraps a path this long; joined, it is the chosen file.
    expect(frame.replace(/\n/g, '')).toContain(`${dir}/beta.png`)
  })

  it('clears the field with esc and offers the modes again', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('~/nowhere-at-all')
    await settle()
    app.stdin.write(ESC)
    await settle()
    app.stdin.write('3')
    await settle()
    const frame = plain(app.lastFrame())
    expect(fieldLine(frame)).toBe('    › or type a path')
    expect(frame).toContain('split · merge · rotate')
  })

  it('opens the command palette in place of the completions', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('/comp')
    await settle()
    const frame = plain(app.lastFrame())
    expect(frame).toContain('compress')
    expect(frame.split('\n')).toHaveLength(24)
    expect(frame.split('\n').at(-1)).toContain('run')
  })
})
