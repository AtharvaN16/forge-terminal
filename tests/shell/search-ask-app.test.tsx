import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { MODE_KINDS } from '../../src/shell/home-art.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))

/** The answer is saved: this test's config must be its own, not the user's. */
let dir: string
const saved = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-search-ask-'))
  process.env.XDG_CONFIG_HOME = dir
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

async function home(prefs: Partial<Preferences> = {}) {
  return render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{
        ...DEFAULT_PREFERENCES,
        theme: 'dark',
        defaultOutput: await makeTempDir(),
        ...prefs,
      }}
    />,
  )
}

/**
 * The first name typed asks before the Mac is searched (2026-10-19, P2): the
 * question on the drop area, ↵ search, esc not now. On a Mac only.
 */
describe.runIf(process.platform === 'darwin')('searching the Mac by name asks first', () => {
  it('asks on the drop area, in the user’s words, with ↵ search and esc not now', async () => {
    const app = await home()
    await settle()
    app.stdin.write('rec')
    await settle()
    const f = plain(app.lastFrame())
    expect(f).toContain('Search your Mac for files by name?')
    // Broken to the drop area's width; read as one sentence.
    expect(f.replace(/\s+/g, ' ')).toContain(
      'macOS will ask for permission to access your files. You can review or change these permissions anytime in System Settings.',
    )
    expect(f.split('\n').at(-1)).toMatch(/↵ +search +esc +not now/)
    expect(f).toMatch(/› rec/)
  })

  it('↵ says yes, for good: the question goes, the answer is saved', async () => {
    const app = await home()
    await settle()
    app.stdin.write('rec')
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    const f = plain(app.lastFrame())
    expect(f).not.toContain('Search your Mac')
    expect(f).toMatch(/› rec/)
    const config = JSON.parse(await readFile(join(dir, 'forge', 'config.json'), 'utf8'))
    expect(config.searchMac).toBe(true)
  })

  it('esc is not now: the question goes, the name stays, and it is not asked again this time', async () => {
    const app = await home()
    await settle()
    app.stdin.write('rec')
    await settle()
    app.stdin.write(ESC)
    await settle()
    let f = plain(app.lastFrame())
    expect(f).not.toContain('Search your Mac')
    expect(f).toMatch(/› rec/)
    app.stdin.write('e')
    await settle()
    f = plain(app.lastFrame())
    expect(f).not.toContain('Search your Mac')
  })

  it('does not ask once the answer is yes, nor for a path', async () => {
    const yes = await home({ searchMac: true })
    await settle()
    yes.stdin.write('rec')
    await settle()
    expect(plain(yes.lastFrame())).not.toContain('Search your Mac')

    const path = await home()
    await settle()
    path.stdin.write('~/zz')
    await settle()
    expect(plain(path.lastFrame())).not.toContain('Search your Mac')
    expect(plain(path.lastFrame())).toContain(MODE_KINDS.convert)
  })
})
