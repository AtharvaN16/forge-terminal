import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import type { Preset } from '../../src/core/preset.js'
import { listCommands, parseCommand } from '../../src/shell/commands.js'
import { RightClickFlow, type RightClickSystem } from '../../src/shell/flows/right-click.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const ENTER = '\r'
const ESC = '\u001b'
const DOWN = '\u001b[B'
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
    syncPresets: async () => {
      calls.push('sync')
    },
  }
  return { system, calls }
}

function screen(on: boolean, platform: NodeJS.Platform = 'darwin', presets?: Preset[]) {
  const { system, calls } = fake(on)
  let closed = false
  const saved: Preset[][] = []
  const app = render(
    <ThemeProvider palette={DARK}>
      <RightClickFlow
        width={80}
        platform={platform}
        system={system}
        {...(presets ? { presets, onPresets: (next: Preset[]) => void saved.push(next) } : {})}
        onClose={() => {
          closed = true
        }}
      />
    </ThemeProvider>,
  )
  return { ...app, calls, saved, closed: () => closed }
}

const webblog: Preset = {
  name: 'webblog',
  steps: { to: 'jpeg', quality: 80 },
  saveTo: 'same',
  quickAction: true,
}
const thumbs: Preset = {
  name: 'thumbs',
  steps: { to: 'webp', resize: { width: 400 } },
  saveTo: 'same',
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
    // The rule down the section's left (U3) starts each line.
    const frame = (lastFrame() ?? '').replace(/▎/g, '').replace(/\s+/g, ' ')
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

  it('closes on esc', async () => {
    const { stdin, closed } = screen(true)
    await settle()
    stdin.write(ESC)
    await settle()
    expect(closed()).toBe(true)
  })
})

describe('/right-click with presets (P1 · U3, quick-actions round four)', () => {
  it('says how many presets are in Quick Actions in one row, whatever how many there are', async () => {
    const { lastFrame } = screen(true, 'darwin', [webblog, thumbs])
    await settle()
    expect(lastFrame()).toContain('1 of 2 presets in Quick Actions')
  })

  it('opens every preset in a window from that row; ↵ turns the lit one on and saves it', async () => {
    const { lastFrame, stdin, saved, calls } = screen(true, 'darwin', [webblog, thumbs])
    await settle()
    stdin.write(DOWN)
    await settle()
    expect(lastFrame()).toMatch(/presets in Quick Actions\s+↵\s+choose/)
    stdin.write(ENTER)
    await settle()
    const open = lastFrame() ?? ''
    expect(open).toContain('Presets in Quick Actions')
    expect(open).toMatch(/● webblog\s+JPEG 80/)
    expect(open).toMatch(/○ thumbs\s+WebP ─▸ 400 wide/)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(saved.at(-1)?.find((p) => p.name === 'thumbs')?.quickAction).toBe(true)
    expect(calls).toContain('sync')
    expect(lastFrame()).toMatch(/● thumbs/)
    stdin.write(ESC)
    await settle()
    expect(lastFrame()).toContain('2 of 2 presets in Quick Actions')
  })

  it('turns a preset off again, its flag gone', async () => {
    const { stdin, saved } = screen(true, 'darwin', [webblog, thumbs])
    await settle()
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(saved.at(-1)?.find((p) => p.name === 'webblog')).not.toHaveProperty('quickAction')
  })

  it('dims the row while Forge is out of the menu, and never lights it', async () => {
    const { stdin, calls, lastFrame } = screen(false, 'darwin', [webblog, thumbs])
    await settle()
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(calls).toEqual(['on'])
    expect(lastFrame()).not.toContain('╭')
  })

  it('adds nothing when no preset is saved', async () => {
    const { lastFrame } = screen(true, 'darwin', [])
    await settle()
    expect(lastFrame()).not.toContain('presets in Quick Actions')
  })

  it('sets Uninstalling Forge apart with a rule down its left (U3)', async () => {
    const { lastFrame } = screen(true, 'darwin', [webblog])
    await settle()
    expect(lastFrame()).toMatch(/▎ Uninstalling Forge/)
    expect(lastFrame()).toMatch(/▎ forge uninstall\s+c\s+copy/)
  })

  it('speaks of the right-click menu on Windows', async () => {
    const { lastFrame } = screen(true, 'win32', [webblog, thumbs])
    await settle()
    expect(lastFrame()).toContain('1 of 2 presets in the right-click menu')
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
