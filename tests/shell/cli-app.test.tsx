import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { COMMANDS } from '../../src/shell/commands.js'
import type { CliSystem } from '../../src/shell/flows/cli.js'
import type { Updater } from '../../src/shell/flows/update.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

const updater: Updater = {
  check: async () => '9.9.9',
  install: async () => {},
  setAuto: async () => {},
  copy: () => {},
}

const copied: string[] = []
const cli: CliSystem = { copy: (text) => void copied.push(text) }

const open = () =>
  render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
      updater={updater}
      cli={cli}
      latestRelease={async () => undefined}
    />,
  )
const frame = (app: ReturnType<typeof open>) => app.lastFrame() ?? ''

describe('/cli in the menu', () => {
  it('is a setting, after /right-click, that says what it does', () => {
    const names = COMMANDS.filter((c) => c.group === 'settings').map((c) => c.name)
    expect(names.indexOf('cli')).toBe(names.indexOf('right-click') + 1)
    expect(COMMANDS.find((c) => c.name === 'cli')?.description).toBe(
      'run Forge using terminal commands',
    )
  })

  it('is listed, and its row says what it does when chosen', async () => {
    const app = open()
    await settle(400)
    app.stdin.write('/cli')
    await until(() => frame(app).includes('run Forge using terminal commands'))
    expect(frame(app)).toContain('/cli')
    expect(frame(app)).toContain('run Forge using terminal commands')
    app.unmount()
  })

  it('opens inside the menu under one bar, named CLI, with its categories', async () => {
    const app = open()
    await settle(400)
    app.stdin.write('/cli')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Convert'))
    expect(frame(app)).toMatch(/Convert\s+Edit\s+PDF\s+Media\s+Tools\s+Setup/)
    const bars = frame(app)
      .split('\n')
      .filter((l) => /^\s*│?\s*\S*\s?[a-z]+\s?\S*╱{4,}/.test(l))
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatch(/menu ╱+.*CLI/)
    app.unmount()
  })

  it('↵ copies an example through the app’s clipboard, and esc goes back with /cli chosen', async () => {
    copied.length = 0
    const app = open()
    await settle(400)
    app.stdin.write('/cli')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('copy all'))
    app.stdin.write(ENTER)
    await until(() => copied.length > 0)
    expect(copied[0]).toMatch(/^forge /)
    app.stdin.write(ESC)
    await until(() => frame(app).includes('/theme'))
    expect(
      frame(app)
        .split('\n')
        .find((l) => l.includes('/cli')),
    ).toMatch(/▌/)
    app.unmount()
  })
})
