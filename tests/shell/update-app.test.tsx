import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
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

const open = (latestRelease: () => Promise<string | undefined>) =>
  render(
    <App
      initialWidth={100}
      initialHeight={30}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
      updater={updater}
      latestRelease={latestRelease}
    />,
  )

describe('/update in the shell', () => {
  it('is listed under settings', async () => {
    const app = open(async () => undefined)
    await settle(400)
    app.stdin.write('/')
    await until(() => (app.lastFrame() ?? '').includes('/update'))
    expect(app.lastFrame()).toMatch(/\/update\s+check for a new version/)
    app.unmount()
  })

  it('home’s band says “/update is available” when a newer Forge is known', async () => {
    const app = open(async () => '9.9.9')
    await until(() => (app.lastFrame() ?? '').includes('/update is available'))
    expect(app.lastFrame()).toMatch(/\/update is available · v\d+\.\d+\.\d+/)
    app.unmount()
  })

  it('says nothing on the band when this is the latest', async () => {
    const app = open(async () => undefined)
    await settle(600)
    expect(app.lastFrame()).not.toContain('/update is available')
    app.unmount()
  })

  it('/update opens the screen, and esc comes home', async () => {
    const app = open(async () => undefined)
    await settle(400)
    app.stdin.write('/update')
    await settle()
    app.stdin.write(ENTER)
    await until(() => (app.lastFrame() ?? '').includes('Forge 9.9.9'))
    expect(app.lastFrame()).toContain('↵ update')
    await settle()
    app.stdin.write(ESC)
    await until(() => (app.lastFrame() ?? '').includes('Drop a file here'))
    expect(app.lastFrame()).toContain('Drop a file here')
    app.unmount()
  })
})
