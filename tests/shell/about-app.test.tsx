import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import type { AboutSystem } from '../../src/shell/flows/about.js'
import type { Updater } from '../../src/shell/flows/update.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

const about: AboutSystem = {
  openUrl: async () => {},
  openFile: async () => {},
  credits: async () => ({ sections: [] }),
}
const updater: Updater = {
  check: async () => '9.9.9',
  install: async () => {},
  setAuto: async () => {},
  copy: () => {},
}

const open = () =>
  render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
      updater={updater}
      about={about}
      latestRelease={async () => undefined}
    />,
  )
const frame = (app: ReturnType<typeof open>) => app.lastFrame() ?? ''
const command = async (app: ReturnType<typeof open>, name: string) => {
  await settle(400)
  app.stdin.write(`/${name}`)
  await settle()
  app.stdin.write(ENTER)
}
/**
 * The bars on screen: each is a chip word followed by hatching. A setting
 * opens inside the / menu's popup (2026-10-17), so its bar may start after
 * the box's edge, and it is the menu's chip with the setting named after it.
 */
const bars = (app: ReturnType<typeof open>) =>
  frame(app)
    .split('\n')
    .filter((l) => /^\s*│?\s*\S*\s?[a-z]+\s?\S*╱{4,}/.test(l))

describe('/about in the shell', () => {
  it('is listed under settings', async () => {
    const app = open()
    await settle(400)
    // At 80 × 24 the settings scroll below the panel, so narrow the list to it.
    app.stdin.write('/ab')
    await until(() => frame(app).includes('/about'))
    expect(frame(app)).toContain('/about')
    app.unmount()
  })

  it('opens inside the menu, under one bar, signed by Atharva Nayak', async () => {
    const app = open()
    await command(app, 'about')
    await until(() => frame(app).includes('by Atharva Nayak'))
    expect(bars(app)).toHaveLength(1)
    expect(bars(app)[0]).toMatch(/menu ╱+.*About/)
    app.unmount()
  })

  it('esc goes back to the commands, /about still chosen', async () => {
    const app = open()
    await command(app, 'about')
    await until(() => frame(app).includes('by Atharva Nayak'))
    await settle()
    app.stdin.write(ESC)
    await until(() => frame(app).includes('/theme'))
    expect(
      frame(app)
        .split('\n')
        .find((l) => l.includes('/about')),
    ).toMatch(/▌/)
    app.unmount()
  })
})

describe('the settings’ bars', () => {
  it('/update has its own bar alone, and its keys on the last row', async () => {
    const app = open()
    await command(app, 'update')
    await until(() => frame(app).includes('↵ update'))
    expect(bars(app)).toHaveLength(1)
    expect(bars(app)[0]).toMatch(/menu ╱+.*Update/)
    const lines = frame(app).split('\n')
    expect(lines.at(-1)).toMatch(/choose/)
    expect(lines).toHaveLength(24)
    app.unmount()
  })

  it('/theme opens under the menu’s bar, named Theme', async () => {
    const app = open()
    await command(app, 'theme')
    await until(() => frame(app).includes('Light'))
    expect(bars(app)).toHaveLength(1)
    expect(bars(app)[0]).toMatch(/menu ╱+.*Theme/)
    app.unmount()
  })
})
