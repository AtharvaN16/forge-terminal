import { describe, expect, it } from 'vitest'
import {
  freeSharpName,
  presetSummary,
  type RunDeps,
  runMenuAction,
  sharpenSummary,
  terminalCommand,
} from '../../src/menu/run.js'

const ARGV = [
  '/usr/local/bin/node',
  '/opt/forge/dist/index.js',
  'menu',
  'open',
  'compress',
  '/a b/p.png',
]

describe('terminalCommand', () => {
  it('opens Terminal with the command, Forge replacing the shell so quitting closes it', () => {
    const [cmd, args] = terminalCommand('Apple_Terminal', ARGV, 'darwin')
    expect(cmd).toBe('/usr/bin/osascript')
    expect(args.join(' ')).toContain('tell application "Terminal" to do script (item 1 of argv)')
    expect(args.at(-1)).toBe(
      `exec '/usr/local/bin/node' '/opt/forge/dist/index.js' 'menu' 'open' 'compress' '/a b/p.png'`,
    )
  })

  it('uses the window Terminal opens on launch, rather than a second one', () => {
    const script = terminalCommand('Apple_Terminal', ARGV, 'darwin')[1].join(' ')
    expect(script).toContain('if application "Terminal" is running then')
    expect(script).toContain('do script (item 1 of argv) in window 1')
  })

  it('falls back to Terminal for a terminal it does not know', () => {
    expect(terminalCommand('vscode', ARGV, 'darwin')[1].join(' ')).toContain('"Terminal"')
    expect(terminalCommand(undefined, ARGV, 'darwin')[1].join(' ')).toContain('"Terminal"')
  })

  it('opens iTerm with the command typed into a new window', () => {
    const [, args] = terminalCommand('iTerm.app', ARGV, 'darwin')
    expect(args.join(' ')).toContain('tell application "iTerm"')
    expect(args.join(' ')).toContain('write text (item 1 of argv)')
  })

  it('opens Ghostty with the command as its own', () => {
    expect(terminalCommand('ghostty', ARGV, 'darwin')).toEqual([
      '/usr/bin/open',
      ['-na', 'Ghostty', '--args', '-e', ...ARGV],
    ])
  })

  it('opens a new Windows Terminal window, else a console window of its own', () => {
    expect(terminalCommand('wt', ARGV, 'win32')).toEqual(['wt.exe', ['-w', 'new', ...ARGV]])
    // A detached process gets no console at all (DETACHED_PROCESS), and the
    // menu's own runs under a hidden one: conhost opens a visible window.
    expect(terminalCommand(undefined, ARGV, 'win32')).toEqual(['conhost.exe', ARGV])
    expect(terminalCommand('console', ARGV, 'win32')).toEqual(['conhost.exe', ARGV])
  })
})

describe('presetSummary', () => {
  it('names the new file, then the preset and its steps (decided, quick-actions round one)', () => {
    expect(
      presetSummary('webblog', [{ output: '/x/photo.jpg', chain: ['JPEG 80', '1920 wide'] }]),
    ).toEqual({ title: 'photo.jpg', body: 'webblog · JPEG 80 ─▸ 1920 wide' })
  })

  it('counts several', () => {
    const made = { output: '/x/a.jpg', chain: ['JPEG 80'] }
    expect(presetSummary('webblog', [made, { ...made, output: '/x/b.jpg' }])).toEqual({
      title: '2 files',
      body: 'webblog · JPEG 80',
    })
  })

  it('says the preset didn’t finish, with the file and Forge’s own reason', () => {
    expect(
      presetSummary('webblog', [
        { input: '/x/photo.png', error: 'Remove background needs its on-device model.' },
      ]),
    ).toEqual({
      title: 'webblog didn’t finish',
      body: 'photo.png: Remove background needs its on-device model.',
    })
  })

  it('says how many of several it finished', () => {
    expect(
      presetSummary('webblog', [
        { output: '/x/a.jpg', chain: ['JPEG 80'] },
        { input: '/x/b.png', error: 'Not an image.' },
      ]),
    ).toEqual({ title: 'webblog finished 1 of 2 files', body: 'b.png: Not an image.' })
  })
})

describe('sharpenSummary', () => {
  it('names the new file for one', () => {
    expect(sharpenSummary([{ output: '/x/photo-sharp.png' }])).toEqual({
      title: 'photo-sharp.png',
      body: 'Sharpened',
    })
  })

  it('counts several', () => {
    expect(sharpenSummary([{ output: '/x/a-sharp.png' }, { output: '/x/b-sharp.png' }])).toEqual({
      title: '2 files',
      body: 'Sharpened',
    })
  })

  it('names a failure and gives Forge’s own reason', () => {
    expect(
      sharpenSummary([{ input: '/x/photo.png', error: 'The Boost extension was removed.' }]),
    ).toEqual({
      title: 'photo.png not sharpened',
      body: 'The Boost extension was removed.',
    })
  })

  it('says how many of several failed', () => {
    expect(
      sharpenSummary([{ output: '/x/a-sharp.png' }, { input: '/x/b.png', error: 'Not an image.' }]),
    ).toEqual({ title: '1 of 2 files sharpened', body: 'b.png: Not an image.' })
  })
})

function deps(over: Partial<RunDeps> = {}) {
  const log: string[] = []
  const d: RunDeps = {
    platform: 'darwin',
    self: ['/usr/local/bin/node', '/opt/forge/dist/index.js'],
    terminal: 'Apple_Terminal',
    launch: async (cmd, args) => {
      log.push(`launch ${cmd} ${args.at(-1)}`)
    },
    sharpen: async (path) => ({ output: path.replace('.png', '-sharp.png') }),
    notify: async (title, body) => {
      log.push(`notify ${title} / ${body}`)
    },
    reveal: async (path) => {
      log.push(`reveal ${path}`)
    },
    ...over,
  }
  return { d, log }
}

describe('freeSharpName', () => {
  it('is photo-sharp.png beside the original, or the next free (n) when that is taken', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const d = mkdtempSync(join(tmpdir(), 'forge-sharp-'))
    const photo = join(d, 'photo.jpg')
    expect(freeSharpName(photo)).toBe(join(d, 'photo-sharp.png'))
    writeFileSync(join(d, 'photo-sharp.png'), '')
    expect(freeSharpName(photo)).toBe(join(d, 'photo-sharp (1).png'))
  })
})

describe('runMenuAction', () => {
  it('opens Forge in a terminal for compress, with the files', async () => {
    const { d, log } = deps()
    await runMenuAction('compress', ['/a b/p.png'], d)
    expect(log).toEqual([
      `launch /usr/bin/osascript ${terminalCommand('Apple_Terminal', ARGV, 'darwin')[1].at(-1)}`,
    ])
  })

  it('opens Forge with nothing staged for Open Forge', async () => {
    const { d, log } = deps()
    await runMenuAction('open', ['/a b/p.png'], d)
    expect(log[0]).toContain(`'menu' 'open' 'open'`)
    expect(log[0]).not.toContain('p.png')
  })

  it('sharpens each file with no window, says so once and selects the result', async () => {
    const { d, log } = deps()
    await runMenuAction('sharpen', ['/x/photo.png'], d)
    expect(log).toEqual(['notify photo-sharp.png / Sharpened', 'reveal /x/photo-sharp.png'])
  })

  it('runs a preset on each file with no window, says so once and selects the last it made', async () => {
    const ran: string[] = []
    const { d, log } = deps({
      runPreset: async (name, path) => {
        ran.push(`${name} ${path}`)
        return { output: path.replace('.png', '.jpg'), chain: ['JPEG 80'] }
      },
    })
    await runMenuAction('preset', ['/x/a.png', '/x/b.png'], d, 'webblog')
    expect(ran).toEqual(['webblog /x/a.png', 'webblog /x/b.png'])
    expect(log).toEqual(['notify 2 files / webblog · JPEG 80', 'reveal /x/b.jpg'])
  })

  it('reveals nothing when nothing was made', async () => {
    const { d, log } = deps({ sharpen: async () => ({ error: 'Not an image.' }) })
    await runMenuAction('sharpen', ['/x/photo.png'], d)
    expect(log).toEqual(['notify photo.png not sharpened / Not an image.'])
  })
})
