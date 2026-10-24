import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { updateDenied } from '../../src/core/errors.js'
import { UpdateFlow, type Updater } from '../../src/shell/flows/update.js'
import type { ReleaseNote } from '../../src/update/check.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const UP = `${ESC}[A`
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const tick = () => new Promise((r) => setTimeout(r, 50))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

const NOTES: ReleaseNote[] = [
  { title: 'Watch a folder', text: 'Drop a folder on Convert to convert what lands in it.' },
  { title: 'Smaller GIFs', text: 'Compress shrinks GIFs further.' },
]
/** More notes than 80 × 24 has rows for. */
const LONG: ReleaseNote[] = Array.from({ length: 9 }, (_, i) => ({
  title: `Change ${i + 1}`,
  text: `What change ${i + 1} does, in a sentence long enough to wrap onto a second line here.`,
}))

function fakeUpdater(
  opts: { latest?: string | undefined; installError?: Error; notes?: ReleaseNote[] } = {},
) {
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
    async whatsNew(v) {
      return v === '0.2.2' ? (opts.notes ?? NOTES) : []
    },
  }
  return { updater, calls, release }
}

const open = (updater: Updater, extra: { onRestart?: () => void; onClose?: () => void } = {}) =>
  render(
    <UpdateFlow
      width={80}
      height={23}
      current="0.2.1"
      auto
      updater={updater}
      onClose={extra.onClose ?? vi.fn()}
      onRestart={extra.onRestart ?? vi.fn()}
    />,
  )
const frame = (f: ReturnType<typeof open>) => f.lastFrame() ?? ''
const lines = (f: ReturnType<typeof open>) => frame(f).split('\n')
const row = (f: ReturnType<typeof open>, has: string) => lines(f).find((l) => l.includes(has)) ?? ''

describe('UpdateFlow (U4)', () => {
  it('checks on opening, then offers the new version, ↵ update at the far right of its row', async () => {
    const { updater, calls } = fakeUpdater()
    const f = open(updater)
    await until(() => frame(f).includes('↵ update'))
    expect(calls.checks).toBe(1)
    expect(row(f, 'Forge 0.2.2')).toMatch(/Forge 0\.2\.2 +new +↵ update *$/)
    expect(frame(f)).toContain('Your version 0.2.1')
    expect(frame(f)).not.toContain('Forge restarts when it is done')
  })

  it('shows what is new on a card under a “what’s new” chip: each name beside its sentence', async () => {
    const { updater } = fakeUpdater()
    const f = open(updater)
    await until(() => frame(f).includes('Watch a folder'))
    expect(row(f, "what's new")).toContain('in 0.2.2')
    expect(row(f, 'Watch a folder')).toMatch(/Watch a folder +Drop a folder on Convert/)
    expect(frame(f)).toContain('Smaller GIFs')
    // In that order: the release, the switch, then the card.
    const at = (s: string) => lines(f).findIndex((l) => l.includes(s))
    expect(at('Forge 0.2.2')).toBeLessThan(at('Check automatically'))
    expect(at('Check automatically')).toBeLessThan(at("what's new"))
    // Everything fits: no scroll bar, nothing more below.
    expect(frame(f)).not.toContain('more')
  })

  it('a long release scrolls a note at a time, says how many are below, and the keys say so', async () => {
    const { updater } = fakeUpdater({ notes: LONG })
    const f = open(updater)
    await until(() => frame(f).includes('Change 1'))
    expect(frame(f)).toMatch(/↓ \d+ more/)
    expect(frame(f)).not.toContain('Change 9')
    await tick()
    f.stdin.write(DOWN) // Check automatically
    await tick()
    f.stdin.write(DOWN) // into the notes
    await until(() => row(f, '↑↓').includes('scroll'))
    expect(frame(f)).toContain('Change 1')
    f.stdin.write(DOWN)
    await until(() => !frame(f).includes('Change 1 '))
    expect(frame(f)).toContain('Change 2')
    for (let i = 0; i < 12; i++) {
      f.stdin.write(DOWN)
      await tick()
    }
    expect(frame(f)).toContain('Change 9')
    expect(frame(f)).not.toMatch(/\d+ more/)
    // Back up to the top, and past it to the switch.
    for (let i = 0; i < 12; i++) {
      f.stdin.write(UP)
      await tick()
    }
    expect(frame(f)).toContain('Change 1')
    expect(row(f, '↑↓')).toContain('choose')
  })

  it('the shell drawing it again checks no second time, and the notes keep their place', async () => {
    // The shell hands a new onChecked on every render (each key press draws
    // it twice: down, then up). Checking again on that reset the scroll and
    // flashed "checking npm" — the notes could not be scrolled.
    const { updater, calls } = fakeUpdater({ notes: LONG })
    const at = (onChecked: () => void) => (
      <UpdateFlow
        width={80}
        height={23}
        current="0.2.1"
        auto
        updater={updater}
        onClose={vi.fn()}
        onRestart={vi.fn()}
        onChecked={onChecked}
      />
    )
    const f = render(at(() => {}))
    await until(() => frame(f).includes('Change 1'))
    await tick()
    f.stdin.write(DOWN)
    await tick()
    f.stdin.write(DOWN)
    await tick()
    f.stdin.write(DOWN)
    await until(() => !frame(f).includes('Change 1 '))
    f.rerender(at(() => {}))
    await tick()
    await tick()
    expect(calls.checks).toBe(1)
    expect(frame(f)).not.toContain('Change 1 ')
    expect(frame(f)).toContain('Change 2')
  })

  it('↓ from Check automatically goes nowhere when every note fits', async () => {
    const { updater } = fakeUpdater()
    const f = open(updater)
    await until(() => frame(f).includes('Watch a folder'))
    await tick()
    f.stdin.write(DOWN)
    await tick()
    f.stdin.write(DOWN)
    await tick()
    expect(row(f, '↑↓')).toContain('choose')
    expect(row(f, '↑↓')).toContain('on / off')
  })

  it('↵ installs with a spinner and no percentage, keeps the notes, then offers to restart', async () => {
    const { updater, calls, release } = fakeUpdater()
    const onRestart = vi.fn()
    const f = open(updater, { onRestart })
    await until(() => frame(f).includes('↵ update'))
    await tick()
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Installing 0.2.2'))
    expect(calls.installs).toEqual(['0.2.2'])
    expect(frame(f)).not.toMatch(/\d%/)
    expect(frame(f)).toContain('Watch a folder')
    release()
    await until(() => frame(f).includes('✓ installed · restart to use it'))
    expect(row(f, 'Forge 0.2.2')).toMatch(/↵ restart *$/)
    await tick()
    f.stdin.write(ENTER)
    await until(() => onRestart.mock.calls.length > 0)
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('when this is the latest, says so, shows no card, and ↵ checks again', async () => {
    const { updater, calls } = fakeUpdater({ latest: '0.2.1' })
    const f = open(updater)
    await until(() => frame(f).includes('✓ the latest'))
    expect(row(f, 'Forge 0.2.1')).toMatch(/Forge 0\.2\.1 ✓ +↵ check again *$/)
    expect(frame(f)).not.toContain("what's new")
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
    // The copy says so beside the pill, then the line goes back to how to use it.
    await until(() => frame(f).includes('✓ copied'))
    expect(row(f, '↵ copy')).toMatch(/↵ copy +✓ copied to the clipboard *$/)
    await until(() => frame(f).includes('run it in any terminal'))
    expect(frame(f)).not.toContain('✓ copied')
  })

  it('when npm cannot be reached, says so and ↵ tries again', async () => {
    const { updater, calls } = fakeUpdater({ latest: undefined })
    const f = open(updater)
    await until(() => frame(f).includes('could not reach npm'))
    expect(row(f, 'Forge 0.2.1')).toMatch(/↵ try again *$/)
    await tick()
    f.stdin.write(ENTER)
    await until(() => calls.checks === 2)
    expect(calls.checks).toBe(2)
  })

  it('Check automatically: ↓ chooses it, ←→ flips its ‹ on ›, and the release stays in view', async () => {
    const { updater, calls } = fakeUpdater()
    const f = open(updater)
    await until(() => frame(f).includes('↵ update'))
    expect(row(f, 'Check automatically')).toMatch(/Check automatically +‹ on ›/)
    await tick()
    f.stdin.write(DOWN)
    await until(() => row(f, '↑↓').includes('on / off'))
    expect(frame(f)).toContain('Your version 0.2.1')
    f.stdin.write(RIGHT)
    await until(() => frame(f).includes('‹ off ›'))
    expect(calls.auto).toEqual([false])
    f.stdin.write(LEFT)
    await until(() => frame(f).includes('‹ on ›'))
    expect(calls.auto).toEqual([false, true])
  })

  it('once installed, esc does not go home: the old Forge’s files are gone, so ↵ restart or quit', async () => {
    const { updater, release } = fakeUpdater()
    const onClose = vi.fn()
    const f = open(updater, { onClose })
    await until(() => frame(f).includes('↵ update'))
    await tick()
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Installing 0.2.2'))
    release()
    await until(() => frame(f).includes('✓ installed · restart to use it'))
    await tick()
    f.stdin.write(ESC)
    await tick()
    expect(onClose).not.toHaveBeenCalled()
    expect(frame(f)).not.toMatch(/esc +home/)
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
