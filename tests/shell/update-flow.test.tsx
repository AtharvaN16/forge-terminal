import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { updateDenied } from '../../src/core/errors.js'
import { UpdateFlow, type Updater } from '../../src/shell/flows/update.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const tick = () => new Promise((r) => setTimeout(r, 50))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

function fakeUpdater(opts: { latest?: string | undefined; installError?: Error } = {}) {
  const calls = {
    checks: 0,
    installs: [] as string[],
    auto: [] as boolean[],
    copied: [] as string[],
  }
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const updater: Updater = {
    async check() {
      calls.checks++
      return 'latest' in opts ? opts.latest : '0.2.2'
    },
    async install(v) {
      calls.installs.push(v)
      await gate
      if (opts.installError) throw opts.installError
    },
    async setAuto(on) {
      calls.auto.push(on)
    },
    copy(text) {
      calls.copied.push(text)
    },
  }
  return { updater, calls, release }
}

const open = (updater: Updater, extra: { onRestart?: () => void; onClose?: () => void } = {}) =>
  render(
    <UpdateFlow
      width={80}
      current="0.2.1"
      auto
      updater={updater}
      onClose={extra.onClose ?? vi.fn()}
      onRestart={extra.onRestart ?? vi.fn()}
    />,
  )
const frame = (f: ReturnType<typeof open>) => f.lastFrame() ?? ''
const lines = (f: ReturnType<typeof open>) => frame(f).split('\n')

describe('UpdateFlow (V4)', () => {
  it('checks on opening, then offers the new version with “new” beside Forge', async () => {
    const { updater, calls } = fakeUpdater()
    const f = open(updater)
    await until(() => frame(f).includes('↵ update'))
    expect(calls.checks).toBe(1)
    const forgeRow = lines(f).find((l) => l.includes('▌ Forge')) ?? ''
    expect(forgeRow).toMatch(/▌ Forge new/)
    expect(frame(f)).toContain('Forge 0.2.2')
    expect(frame(f)).toContain('Your version: 0.2.1')
  })

  it('↵ installs with a spinner and no percentage, then offers to restart', async () => {
    const { updater, calls, release } = fakeUpdater()
    const onRestart = vi.fn()
    const f = open(updater, { onRestart })
    await until(() => frame(f).includes('↵ update'))
    await tick()
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Installing 0.2.2'))
    expect(calls.installs).toEqual(['0.2.2'])
    expect(frame(f)).not.toMatch(/\d%/)
    release()
    await until(() => frame(f).includes('✓ installed · restart to use it'))
    await tick()
    f.stdin.write(ENTER)
    await until(() => onRestart.mock.calls.length > 0)
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('when this is the latest, says so and ↵ checks again', async () => {
    const { updater, calls } = fakeUpdater({ latest: '0.2.1' })
    const f = open(updater)
    await until(() => frame(f).includes('✓ the latest'))
    expect(frame(f)).toContain('Forge 0.2.1')
    expect(lines(f).find((l) => l.includes('▌ Forge'))).toMatch(/▌ Forge ✓/)
    await tick()
    f.stdin.write(ENTER)
    await until(() => calls.checks === 2)
    expect(calls.checks).toBe(2)
  })

  it('when npm is refused, shows why in one row and ↵ copies the sudo command', async () => {
    const { updater, calls, release } = fakeUpdater({
      installError: updateDenied('0.2.2', 'darwin'),
    })
    const f = open(updater)
    await until(() => frame(f).includes('↵ update'))
    await tick()
    f.stdin.write(ENTER)
    release()
    await until(() => frame(f).includes('↵ copy'))
    expect(frame(f)).toContain('npm needs permission to update Forge')
    expect(frame(f)).toContain('sudo npm i -g forge-terminal@0.2.2')
    await tick()
    f.stdin.write(ENTER)
    await until(() => calls.copied.length > 0)
    expect(calls.copied).toEqual(['sudo npm i -g forge-terminal@0.2.2'])
  })

  it('when npm cannot be reached, says so and ↵ tries again', async () => {
    const { updater, calls } = fakeUpdater({ latest: undefined })
    const f = open(updater)
    await until(() => frame(f).includes('could not reach npm'))
    await tick()
    f.stdin.write(ENTER)
    await until(() => calls.checks === 2)
    expect(calls.checks).toBe(2)
  })

  it('Check automatically is a list row under a gap, ←→ flips its ‹ on ›, and its side is blank', async () => {
    const { updater, calls } = fakeUpdater()
    const f = open(updater)
    await until(() => frame(f).includes('↵ update'))
    const at = lines(f).findIndex((l) => l.includes('▌ Forge'))
    // The gap is in the list's column; the sheet beside it carries on.
    expect(
      lines(f)
        [at + 1]?.slice(0, 2 + 31)
        .trim(),
    ).toBe('')
    expect(lines(f)[at + 2]).toMatch(/Check automatically.*‹ on ›/)
    await tick()
    f.stdin.write(DOWN)
    await until(() => frame(f).includes('▌ Check automatically'))
    expect(frame(f)).not.toContain('Your version')
    f.stdin.write(RIGHT)
    await until(() => frame(f).includes('‹ off ›'))
    expect(calls.auto).toEqual([false])
    f.stdin.write(LEFT)
    await until(() => frame(f).includes('‹ on ›'))
    expect(calls.auto).toEqual([false, true])
  })

  it('esc goes home', async () => {
    const onClose = vi.fn()
    const f = open(fakeUpdater().updater, { onClose })
    await until(() => frame(f).includes('↵ update'))
    await tick()
    f.stdin.write(ESC)
    await until(() => onClose.mock.calls.length > 0)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
