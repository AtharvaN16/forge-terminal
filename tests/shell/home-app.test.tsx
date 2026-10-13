import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
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
    // "/ commands" is a tab of its own, so the key row no longer says it.
    expect(frame.split('\n')[6]).toContain('/ commands')
    expect(frame.split('\n').at(-1)).not.toContain('commands')
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
    // The field wraps a path this long, inside its shelf; joined, it is the chosen file.
    expect(
      frame
        .split('\n')
        .map((l) => l.trim())
        .join(''),
    ).toContain(`${dir}/beta.png`)
  })

  it('answers a typed path that is not there with a row under the field, not a block above it', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('/definitely/not/here.jpg')
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    let lines = plain(app.lastFrame()).split('\n')
    const at = lines.findIndex((l) => l.startsWith('    › '))
    // The shelf's padding, a blank row, then the tinted row: title, three cells, the short reason.
    expect(lines[at + 1]?.trim()).toBe('')
    expect(lines[at + 2]?.trim()).toBe('')
    expect(lines[at + 3]).toMatch(/^ +File not found {3}here\.jpg could not be found\. *$/)
    // Nothing went to the scrollback: no "failed" tab, no detail or hint.
    expect(lines.join('\n')).not.toMatch(/^\s+failed\s*$/m)
    expect(lines.join('\n')).not.toContain('Check the filename')

    // The path stays in the field, to be corrected.
    expect(lines[at]?.trimEnd()).toBe('    › /definitely/not/here.jpg')

    // The next keystroke clears the row, and the completions come back to the list.
    app.stdin.write('x')
    await settle()
    lines = plain(app.lastFrame()).split('\n')
    expect(lines.join('\n')).not.toContain('File not found')
    expect(lines.find((l) => l.startsWith('    › '))?.trimEnd()).toBe(
      '    › /definitely/not/here.jpgx',
    )
  }, 20_000)

  describe('a refusal row on home, with the field empty (a dropped file)', () => {
    const CTRL_N = String.fromCharCode(14)

    /** Home with a dropped file it cannot read: the row is up and the field is empty. */
    async function refused() {
      const dir = await makeTempDir()
      const broken = join(dir, 'broken.png')
      await writeFile(broken, 'this is not a png')
      const app = home(dir)
      await settle()
      app.stdin.write(broken)
      await settle(500)
      expect(plain(app.lastFrame())).toContain('broken.png')
      return app
    }

    it('goes away with esc', async () => {
      const app = await refused()
      app.stdin.write(ESC)
      await settle()
      expect(plain(app.lastFrame())).not.toContain('broken.png')
    }, 20_000)

    it('goes away with ctrl-n', async () => {
      const app = await refused()
      app.stdin.write(CTRL_N)
      await settle()
      expect(plain(app.lastFrame())).not.toContain('broken.png')
    }, 20_000)
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

  describe('commands, as the fourth tab (N6)', () => {
    const BACKSPACE = String.fromCharCode(127)
    const ENTER = '\r'

    it('swaps the dots for the list in place when / is typed', async () => {
      const app = home(await makeTempDir())
      await settle()
      app.stdin.write('/')
      await settle()
      const frame = plain(app.lastFrame())
      expect(frame).not.toContain('Drop a file here')
      expect(frame).toContain('█▀▀▀ █▀▀█')
      expect(frame).toMatch(/modes ─+ *\n.*▌ \/convert/)
      expect(frame).toContain('settings')
      expect(fieldLine(frame)).toBe('    › /')
      expect(frame.split('\n').at(-1)).toMatch(/run +esc +back/)
    })

    it('runs the chosen mode as its number key would: tab, dots and an empty field', async () => {
      const app = home(await makeTempDir())
      await settle()
      app.stdin.write('/co')
      await settle()
      app.stdin.write(DOWN)
      await settle()
      expect(plain(app.lastFrame())).toContain('▌ /compress')
      app.stdin.write(ENTER)
      await settle()
      const frame = plain(app.lastFrame())
      expect(frame).toContain('Drop a file here')
      expect(frame).toContain('images · PDF')
      expect(fieldLine(frame)).toBe('    › or type a path')
    })

    it('puts the mode tab and the dots back on esc, or when the slash is deleted', async () => {
      const app = home(await makeTempDir())
      await settle()
      app.stdin.write('/')
      await settle()
      app.stdin.write(ESC)
      await settle()
      expect(plain(app.lastFrame())).toContain('Drop a file here')

      app.stdin.write('/c')
      await settle()
      app.stdin.write(BACKSPACE)
      await settle()
      expect(plain(app.lastFrame())).not.toContain('Drop a file here')
      app.stdin.write(BACKSPACE)
      await settle()
      const frame = plain(app.lastFrame())
      expect(frame).toContain('Drop a file here')
      expect(frame).toContain('images · HEIC · PDF · Word')
    })

    it('stops being a command once an absolute path has a second slash', async () => {
      const app = home(await makeTempDir())
      await settle()
      app.stdin.write('/Users')
      await settle()
      expect(plain(app.lastFrame())).toContain('no command matches /Users')
      app.stdin.write('/')
      await settle()
      const frame = plain(app.lastFrame())
      expect(frame).toContain('Drop a file here')
      expect(frame).not.toContain('no command matches')
    })
  })
})
