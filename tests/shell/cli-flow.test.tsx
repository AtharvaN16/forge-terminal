import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { CLI_TABS } from '../../src/core/cli-reference.js'
import { CliFlow, type CliSystem } from '../../src/shell/flows/cli.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}
const tick = () => new Promise((r) => setTimeout(r, 50))

const convert = CLI_TABS[0]?.items ?? []
const edit = CLI_TABS[1]?.items ?? []

function fakeSystem() {
  const copied: string[] = []
  const system: CliSystem = { copy: (text) => void copied.push(text) }
  return { system, copied }
}

/** Inside the menu's box at 80 × 24: 74 wide, 15 rows of body. */
const open = (system: CliSystem, onClose = vi.fn()) =>
  render(<CliFlow width={74} height={15} system={system} onClose={onClose} />)
const frame = (f: ReturnType<typeof open>) => f.lastFrame() ?? ''

describe('CliFlow', () => {
  it('has the six categories on one rule, Convert first', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('Convert'))
    expect(frame(f)).toMatch(/Convert\s+Edit\s+PDF\s+Media\s+Tools\s+Setup/)
    f.unmount()
  })

  it('lists the category’s rows, each with what it does', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('--to'))
    expect(frame(f)).toMatch(/-t, --to <format>\s+convert to another format/)
    expect(frame(f)).toMatch(/-o, --output <path>\s+where to save/)
    f.unmount()
  })

  it('shows the first row’s example on a strip under the list', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('$ forge'))
    expect(frame(f)).toContain(`$ ${convert[0]?.ex}`)
    f.unmount()
  })

  it('keeps a blank line between the list and its example', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('$ forge'))
    const lines = frame(f).split('\n')
    const shelf = lines.findIndex((l) => l.includes('$ forge'))
    expect(lines[shelf - 1]?.trim()).toBe('')
    expect(lines[shelf - 2]?.trim()).toMatch(/↓ \d+ more/)
    f.unmount()
  })

  it('↓ chooses the next row and its example replaces the last', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('$ forge'))
    f.stdin.write(DOWN)
    await until(() => frame(f).includes(`$ ${convert[1]?.ex}`))
    expect(frame(f)).toContain(`$ ${convert[1]?.ex}`)
    expect(frame(f)).not.toContain(`$ ${convert[0]?.ex}`)
    f.stdin.write(UP)
    await until(() => frame(f).includes(`$ ${convert[0]?.ex}`))
    expect(frame(f)).toContain(`$ ${convert[0]?.ex}`)
    f.unmount()
  })

  it('→ opens the next category on its first row; ← comes back', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('$ forge'))
    f.stdin.write(DOWN)
    f.stdin.write(RIGHT)
    await until(() => frame(f).includes('--resize'))
    expect(frame(f)).toContain(`$ ${edit[0]?.ex}`)
    expect(frame(f)).not.toContain('--keep-metadata')
    f.stdin.write(LEFT)
    await until(() => frame(f).includes('--keep-metadata'))
    expect(frame(f)).toContain(`$ ${convert[0]?.ex}`)
    f.unmount()
  })

  it('stops at the first and last category rather than wrapping', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('$ forge'))
    f.stdin.write(LEFT)
    await tick()
    expect(frame(f)).toContain(`$ ${convert[0]?.ex}`)
    for (let i = 0; i < 9; i++) f.stdin.write(RIGHT)
    await until(() => frame(f).includes('mcp'))
    expect(frame(f)).toMatch(/\bmcp\b/)
    f.unmount()
  })

  it('says how many rows are below, and scrolls to keep the chosen one in view', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('more'))
    expect(frame(f)).toMatch(/↓ \d+ more/)
    expect(frame(f)).not.toContain('--debug')
    for (let i = 0; i < convert.length - 1; i++) f.stdin.write(DOWN)
    await until(() => frame(f).includes('--debug'))
    expect(frame(f)).toContain(`$ ${convert[convert.length - 1]?.ex}`)
    expect(frame(f)).not.toContain('--to <format>')
    f.unmount()
  })

  it('↵ copies the chosen row’s example and says so', async () => {
    const { system, copied } = fakeSystem()
    const f = open(system)
    await until(() => frame(f).includes('$ forge'))
    f.stdin.write(DOWN)
    f.stdin.write(DOWN)
    await tick()
    f.stdin.write(ENTER)
    await until(() => copied.length > 0)
    expect(copied).toEqual([convert[2]?.ex])
    await until(() => frame(f).includes('copied'))
    expect(frame(f)).toContain('✓ copied')
    f.unmount()
  })

  it('names its keys', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('copy example'))
    expect(frame(f)).toMatch(/↑↓.*choose/)
    expect(frame(f)).toMatch(/←→.*category/)
    expect(frame(f)).toMatch(/↵.*copy example/)
    f.unmount()
  })

  it('esc closes it', async () => {
    const onClose = vi.fn()
    const f = open(fakeSystem().system, onClose)
    await until(() => frame(f).includes('Convert'))
    f.stdin.write(ESC)
    await until(() => onClose.mock.calls.length > 0)
    expect(onClose).toHaveBeenCalledTimes(1)
    f.unmount()
  })
})
