import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { MODE_FORMATS, MODE_KINDS } from '../../src/shell/home-art.js'
import { DARK } from '../../src/shell/theme.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

const ESC = String.fromCharCode(27)
const TAB = '\t'
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))

function home(dir: string) {
  return render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
}

const field = (frame: string) => frame.split('\n').find((l) => l.startsWith('    › ')) ?? ''

/**
 * Tab on a bare home lists the supported formats on the drop surface, until the
 * next key (mockups/kinds-2026-10.html, Q2 · K2; the key is Tab, not ?, which some terminals send as shift-/ and the menu takes). A terminal never says a
 * letter key came up, so "while held" is "until the next key".
 */
describe('Tab on home', () => {
  it('says nothing in the field: the key row says tab (2026-10-19)', async () => {
    const app = home(await makeTempDir())
    await settle()
    expect(field(plain(app.lastFrame())).trimEnd()).toBe('    › OR search or enter a file path…')
  })

  it('lists the formats a line a kind, in place of the dots', async () => {
    const app = home(await makeTempDir())
    await settle()
    expect(plain(app.lastFrame())).toContain(MODE_KINDS.convert)
    app.stdin.write(TAB)
    await settle()
    const frame = plain(app.lastFrame())
    expect(frame).toContain('FLAC')
    expect(frame).not.toContain('Drop a file here')
    for (const [kind, formats] of MODE_FORMATS.convert ?? []) {
      expect(frame).toContain(kind)
      expect(frame).toContain(formats)
    }
    // Word, sound and video are in it: convert takes them.
    expect(frame).toContain('FLAC')
    expect(frame).toContain('MKV')
    // The field is still empty: Tab types nothing.
    expect(field(frame)).toMatch(/› OR search or enter a file path…/)
    // The window is as tall as ever.
    expect(frame.split('\n')).toHaveLength(23)
  })

  it('puts the drop surface back on the next key, whichever it is', async () => {
    for (const key of [TAB, ESC, ' ', 'x']) {
      const app = home(await makeTempDir())
      await settle()
      app.stdin.write(TAB)
      await settle()
      expect(plain(app.lastFrame())).toContain('FLAC')
      app.stdin.write(key)
      await settle()
      const frame = plain(app.lastFrame())
      expect(frame).not.toContain('FLAC')
      expect(frame).toContain('Drop a file here')
      app.unmount()
    }
  })

  it('a mode key puts it away and switches, in one press', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write(TAB)
    await settle()
    app.stdin.write('2')
    await settle()
    const frame = plain(app.lastFrame())
    expect(frame).not.toContain('FLAC')
    expect(frame).toContain(MODE_KINDS.compress)
  })

  it('lists compress’s own formats, and edit’s', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('2')
    await settle()
    app.stdin.write(TAB)
    await settle()
    let frame = plain(app.lastFrame())
    expect(frame).toContain('FLAC')
    expect(frame).toContain('JPEG · PNG · WebP · AVIF · GIF')
    expect(frame).toContain('MKV')
    expect(frame).toContain('FLAC')
    expect(frame).not.toContain('HEIC')
    app.stdin.write(ESC)
    await settle()
    app.stdin.write('4')
    await settle()
    app.stdin.write(TAB)
    await settle()
    frame = plain(app.lastFrame())
    expect(frame).toContain('HEIC')
    expect(frame).toContain('TIFF')
    expect(frame).toContain('MKV')
    expect(frame).toContain('FLAC')
  })

  it('names every kind a mode takes on its line, and all five PDF actions', () => {
    expect(MODE_KINDS.compress).toBe('Images · Video · Audio · PDF')
    expect(MODE_KINDS.edit).toBe('Images · Video · Audio')
    for (const verb of ['split', 'merge', 'rotate', 'extract', 'delete'])
      expect(MODE_KINDS.pdf).toContain(verb)
  })

  it('does nothing once the field has text (it completes), or where nothing is listed', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('a')
    await settle()
    app.stdin.write(TAB)
    await settle()
    expect(field(plain(app.lastFrame()))).toContain('› a')
    expect(plain(app.lastFrame())).not.toContain('FLAC')

    const pdf = home(await makeTempDir())
    await settle()
    pdf.stdin.write('3')
    await settle()
    pdf.stdin.write(TAB)
    await settle()
    expect(plain(pdf.lastFrame())).toContain('split · merge · rotate')
    expect(plain(pdf.lastFrame())).not.toContain('FLAC')
  })

  it('is not ?: that is shift-/ and the menu’s', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('?')
    await settle()
    expect(plain(app.lastFrame())).not.toContain('FLAC')
  })

  it('leaves a staged file alone', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'a.png')
    const app = home(dir)
    await settle()
    app.stdin.write(`${png}\r`)
    await settle(400)
    app.stdin.write(TAB)
    await settle()
    const frame = plain(app.lastFrame())
    expect(frame).not.toContain('FLAC')
    expect(frame).toContain('a.png')
  })
})

/**
 * The bottom rows around it (2026-10-19): "tab supported formats" on the key
 * row where "ctrl-n new" was; "esc clear" on the key row while typing and
 * while something is staged (beside ↵, 2026-10-21).
 */
describe('the key row and the row above its rule', () => {
  const rows = (frame: string) => {
    const lines = frame.split('\n')
    return { keys: lines.at(-1) ?? '', hint: lines.at(-3) ?? '' }
  }

  it('says tab for the supported formats, and not ctrl-n new, on a bare home', async () => {
    const app = home(await makeTempDir())
    await settle()
    const { keys, hint } = rows(plain(app.lastFrame()))
    expect(keys).toMatch(/tab +supported formats · 1–6 ←→ +mode · ctrl-c quit/)
    expect(keys).not.toContain('ctrl-n')
    expect(keys).not.toContain('esc')
    expect(hint).toMatch(/\/ +menu\s*$/)
    expect(hint).not.toContain('esc')
  })

  it('leaves tab out where it does nothing: pdf mode', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('3')
    await settle()
    expect(rows(plain(app.lastFrame())).keys).not.toContain('supported formats')
  })

  it('puts esc clear on the key row, and enter in the field, once something is typed', async () => {
    const app = home(await makeTempDir())
    await settle()
    app.stdin.write('~/zz')
    await settle()
    const { keys, hint } = rows(plain(app.lastFrame()))
    expect(keys).toMatch(/^ +esc +clear/)
    expect(plain(app.lastFrame())).toMatch(/› ~\/zz +↵ enter/)
    expect(hint).not.toContain('esc')
    app.stdin.write(ESC)
    await settle()
    const after = rows(plain(app.lastFrame()))
    expect(after.hint).toMatch(/\/ +menu\s*$/)
    expect(after.keys).not.toContain('esc')
  })

  it('puts it there once a file is staged, and takes it away when cleared', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'a.png')
    const app = home(dir)
    await settle()
    app.stdin.write(`${png}\r`)
    await settle(400)
    const { keys, hint } = rows(plain(app.lastFrame()))
    expect(keys).toMatch(/^ +↵ +\w+ +esc +clear/)
    expect(hint).not.toContain('esc')
    expect(hint).toMatch(/\/ +menu\s*$/)
    app.stdin.write(ESC)
    await settle()
    expect(rows(plain(app.lastFrame())).keys).not.toContain('esc')
  })
})

/**
 * While Tab holds the formats open its key is lit in the mode's colour and
 * nothing else on the row changes (2026-10-20, B on mockups/key-state-2026-10-round3.html).
 */
describe('Tab held on', () => {
  const lit = (frame: string | undefined) => {
    const last = (frame ?? '').split('\n').findLast((l) => plain(l).trim() !== '') ?? ''
    const cells = ansiRow(last, Math.max(80, [...plain(last)].length))
    const text = cells.map((c) => c.ch).join('')
    const at = text.indexOf('tab supported formats')
    return { tab: cells[at], words: cells[at + 4], mode: cells[text.indexOf('mode')] }
  }

  it('turns the key orange, its words and the other keys as they were', async () => {
    const app = home(await makeTempDir())
    await settle()
    const before = lit(app.lastFrame())
    app.stdin.write(TAB)
    await settle()
    const after = lit(app.lastFrame())
    const colour = DARK.brand
    expect(after.tab).toMatchObject({ ch: 't', fg: colour, b: true })
    expect(before.tab?.fg).not.toBe(colour)
    expect(after.words).toEqual(before.words)
    expect(after.mode).toEqual(before.mode)
    // The next key puts it back.
    app.stdin.write(ESC)
    await settle()
    expect(lit(app.lastFrame()).tab).toEqual(before.tab)
    app.unmount()
  })
})
