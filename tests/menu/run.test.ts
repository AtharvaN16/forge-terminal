import { describe, expect, it } from 'vitest'
import { type RunDeps, runMenuAction, sharpenSummary, terminalCommand } from '../../src/menu/run.js'

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

  it('opens a new Windows Terminal window, else Node in a console of its own', () => {
    expect(terminalCommand('wt', ARGV, 'win32')).toEqual(['wt.exe', ['-w', 'new', ...ARGV]])
    // launched detached, which on Windows gives the process its own console window
    expect(terminalCommand(undefined, ARGV, 'win32')).toEqual([ARGV[0], ARGV.slice(1)])
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

  it('reveals nothing when nothing was made', async () => {
    const { d, log } = deps({ sharpen: async () => ({ error: 'Not an image.' }) })
    await runMenuAction('sharpen', ['/x/photo.png'], d)
    expect(log).toEqual(['notify photo.png not sharpened / Not an image.'])
  })
})
