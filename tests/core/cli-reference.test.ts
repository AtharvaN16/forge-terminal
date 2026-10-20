import { describe, expect, it, vi } from 'vitest'
import { COMMANDS_HELP, parseArgs } from '../../src/cli/args.js'
import { CLI_TABS } from '../../src/core/cli-reference.js'

const items = CLI_TABS.flatMap((t) => t.items)

/** What `forge --help` says, as Commander prints it. */
function helpText(): string {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    parseArgs(['--help'])
  } catch {
    // Commander ends the parse by throwing after it prints.
  }
  const out = write.mock.calls.map((c) => String(c[0])).join('')
  write.mockRestore()
  return out
}

/** `forge photo.png --background "#fff"` as the argv it would be typed as. */
const argvOf = (example: string): string[] =>
  [...example.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '').slice(1)

describe('the CLI reference', () => {
  it('has the six categories, in order', () => {
    expect(CLI_TABS.map((t) => t.name)).toEqual([
      'Convert',
      'Edit',
      'PDF',
      'Media',
      'Tools',
      'Setup',
    ])
  })

  it('lists every flag `forge --help` lists, so a new flag cannot be left out', () => {
    const flags = [...new Set(helpText().match(/--[a-z][a-z-]*/g) ?? [])].filter(
      (f) => f !== '--help' && f !== '--version',
    )
    expect(flags.length).toBeGreaterThan(20)
    const missing = flags.filter(
      (flag) => !items.some((it) => new RegExp(`${flag}(?![a-z-])`).test(`${it.name} ${it.does}`)),
    )
    expect(missing).toEqual([])
  })

  it('lists every subcommand the help names', () => {
    const subcommands = [...COMMANDS_HELP.matchAll(/^ {2}forge ([a-z]+)/gm)].map((m) => m[1])
    expect(subcommands).toContain('transcribe')
    const missing = subcommands.filter((sub) => !items.some((it) => it.name.split(' ')[0] === sub))
    expect(missing).toEqual([])
  })

  it('gives every row a meaning and an example that runs forge', () => {
    for (const it of items) {
      expect(it.does.length, it.name).toBeGreaterThan(0)
      expect(it.ex, it.name).toMatch(/forge/)
    }
  })

  // `forge menu` is answered in src/index.ts before parseArgs sees it.
  it('has examples that forge itself accepts', () => {
    for (const it of items.filter(
      (i) => i.ex.startsWith('forge ') && !i.ex.startsWith('forge menu'),
    )) {
      expect(() => parseArgs(argvOf(it.ex)), it.ex).not.toThrow()
    }
  })

  it('keeps each line short enough for the 80-column box', () => {
    for (const it of items) {
      expect(it.name.length, it.name).toBeLessThanOrEqual(26)
      expect(it.does.length, it.name).toBeLessThanOrEqual(44)
      expect(it.ex.length + 4, it.name).toBeLessThanOrEqual(68)
    }
  })

  it('gives /theme and /right-click a row each, in Setup', () => {
    const setup = CLI_TABS.find((t) => t.name === 'Setup')?.items.map((i) => i.name) ?? []
    expect(setup).toContain('config set theme')
    expect(setup).toContain('menu [install | remove]')
  })
})
