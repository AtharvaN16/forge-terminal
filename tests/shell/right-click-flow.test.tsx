import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { listCommands, parseCommand } from '../../src/shell/commands.js'
import { RightClickFlow, type RightClickSystem } from '../../src/shell/flows/right-click.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const ENTER = '\r'
const ESC = '\u001b'
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

function fake(on: boolean) {
  const calls: string[] = []
  let state = on
  const system: RightClickSystem = {
    isOn: async () => state,
    turnOn: async () => {
      calls.push('on')
      state = true
    },
    turnOff: async () => {
      calls.push('off')
      state = false
    },
    copy: (text) => calls.push(`copy ${text}`),
  }
  return { system, calls }
}

function screen(on: boolean, platform: NodeJS.Platform = 'darwin') {
  const { system, calls } = fake(on)
  let closed = false
  const app = render(
    <ThemeProvider palette={DARK}>
      <RightClickFlow
        width={80}
        platform={platform}
        system={system}
        onClose={() => {
          closed = true
        }}
      />
    </ThemeProvider>,
  )
  return { ...app, calls, closed: () => closed }
}

describe('/right-click (S4)', () => {
  it('says Forge is in Finder’s Quick Actions, with ↵ beside it to turn it off', async () => {
    const { lastFrame } = screen(true)
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('● Forge is in Finder’s Quick Actions')
    expect(frame).toMatch(/Quick Actions\s+↵\s+turn off/)
  })

  it('turns it off on ↵, and then says so, with ↵ to turn it on', async () => {
    const { lastFrame, stdin, calls } = screen(true)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(calls).toEqual(['off'])
    expect(lastFrame()).toMatch(/○ Forge is not in Finder’s Quick Actions\s+↵\s+turn on/)
  })

  it('turns it back on on ↵', async () => {
    const { stdin, calls, lastFrame } = screen(false)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(calls).toEqual(['on'])
    expect(lastFrame()).toContain('● Forge is in Finder’s Quick Actions')
  })

  it('explains why uninstalling is here, in the user’s words, with c beside the command', async () => {
    const { lastFrame, stdin, calls } = screen(true)
    await settle()
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(frame).toContain('Uninstalling Forge')
    expect(frame).toContain(
      'npm uninstall won’t remove Forge from your Mac’s Quick Actions. To remove it, run the command below to uninstall Forge and delete any remaining settings.',
    )
    expect(lastFrame()).toMatch(/forge uninstall\s+c\s+copy/)
    stdin.write('c')
    await settle()
    expect(calls).toEqual(['copy forge uninstall'])
  })

  it('speaks of the PC’s right-click menu on Windows', async () => {
    const { lastFrame } = screen(true, 'win32')
    await settle()
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(frame).toContain('● Forge is in the right-click menu')
    expect(frame).toContain('npm uninstall won’t remove Forge from your PC’s right-click menu.')
  })

  it('speaks of the file manager’s right-click menu on Linux', async () => {
    const { lastFrame } = screen(false, 'linux')
    await settle()
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(frame).toContain('○ Forge is not in the right-click menu')
    expect(frame).toContain(
      'npm uninstall won’t remove Forge from your file manager’s right-click menu.',
    )
  })

  it('closes on esc', async () => {
    const { stdin, closed } = screen(true)
    await settle()
    stdin.write(ESC)
    await settle()
    expect(closed()).toBe(true)
  })
})

describe('/right-click in the app', () => {
  it('opens from the / menu, and esc goes back to it', async () => {
    const { App } = await import('../../src/shell/App.js')
    const { DEFAULT_PREFERENCES } = await import('../../src/config/preferences.js')
    const { system } = fake(true)
    const app = render(
      <App
        initialWidth={80}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }}
        rightClick={system}
      />,
    )
    app.stdin.write('/right-click')
    await settle(200)
    app.stdin.write(ENTER)
    await settle(200)
    expect(app.lastFrame()).toContain('Uninstalling Forge')
    app.stdin.write(ESC)
    await settle(200)
    expect(app.lastFrame()).not.toContain('Uninstalling Forge')
    expect(app.lastFrame()).toContain('/right-click')
  })
})

describe('/right-click in the / menu', () => {
  it('is a setting, after /extensions and before /cli', () => {
    expect(parseCommand('/right-click')?.group).toBe('settings')
    const names = listCommands('').items.map((c) => c.name)
    expect(names.indexOf('right-click')).toBe(names.indexOf('extensions') + 1)
    expect(names.indexOf('cli')).toBe(names.indexOf('right-click') + 1)
  })
})
