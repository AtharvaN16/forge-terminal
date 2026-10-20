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
    expect(app.lastFrame()).toContain('/update')
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

  it('/update opens the screen, and esc goes back to the commands', async () => {
    const app = open(async () => undefined)
    await settle(400)
    app.stdin.write('/update')
    await settle()
    app.stdin.write(ENTER)
    await until(() => (app.lastFrame() ?? '').includes('Forge 9.9.9'))
    expect(app.lastFrame()).toContain('↵ update')
    await settle()
    app.stdin.write(ESC)
    await until(() => (app.lastFrame() ?? '').includes('settings'))
    expect(app.lastFrame()).toContain('/update')
    expect(app.lastFrame()).not.toContain('Forge 9.9.9')
    app.unmount()
  })

  it('puts the keys on the window’s last row', async () => {
    const app = open(async () => undefined)
    await settle(400)
    app.stdin.write('/update')
    await settle()
    app.stdin.write(ENTER)
    await until(() => (app.lastFrame() ?? '').includes('Forge 9.9.9'))
    const lines = (app.lastFrame() ?? '').split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(30)
    expect(lines.at(-1)).toContain('ctrl-c quit')
    app.unmount()
  })
})

describe('/update’s notes card in the popup', () => {
  const NOTES = Array.from({ length: 6 }, (_, i) => ({
    title: `Change ${i + 1}`,
    text: `What change ${i + 1} does, in a sentence long enough to wrap onto a second line here.`,
  }))
  const frameAt = async (height: number) => {
    const app = render(
      <App
        initialWidth={80}
        initialHeight={height}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
        updater={{ ...updater, whatsNew: async () => NOTES }}
        latestRelease={async () => '9.9.9'}
      />,
    )
    await settle(400)
    app.stdin.write('/update')
    await settle()
    app.stdin.write(ENTER)
    await until(() => (app.lastFrame() ?? '').includes('Change 1'))
    const lines = (app.lastFrame() ?? '').split('\n')
    app.unmount()
    return lines
  }

  it('takes every row the popup has, down to the blank row above the field', async () => {
    const lines = await frameAt(24)
    const more = lines.findIndex((l) => /↓ \d+ more/.test(l))
    const field = lines.findIndex((l) => l.includes('› /update'))
    expect(more).toBeGreaterThan(0)
    // The "more" row, then the popup's blank row, then its field: nothing idle.
    expect(field - more).toBeLessThanOrEqual(3)
  })
})
