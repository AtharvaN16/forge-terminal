import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { CATALOG } from '../../src/extensions/catalog.js'
import type { LockHolder } from '../../src/extensions/lock.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { ExtensionsFlow, type ExtensionsManager } from '../../src/shell/flows/extensions.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const tick = () => new Promise((r) => setTimeout(r, 50))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

const MB = 1_000_000

/** An in-memory manager: install blocks on `gate` so the test sees the in-flight frame. */
function fakeManager(opts: { installed?: string[]; inUse?: Record<string, LockHolder> } = {}) {
  const have = new Set<string>(opts.installed ?? [])
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const manager: ExtensionsManager = {
    async list() {
      return CATALOG.map(
        (entry): ExtensionStatus => ({
          entry,
          ...(have.has(entry.id) ? { installed: entry.version, installedBytes: 15 * MB } : {}),
          updateAvailable: false,
          supported: true,
          downloadBytes: 15 * MB,
        }),
      )
    },
    async install(id, { onProgress }) {
      onProgress(6.2 * MB, 15 * MB)
      await gate
      have.add(id)
    },
    async remove(id) {
      return have.delete(id)
    },
    async inUse(id) {
      return opts.inUse?.[id]
    },
  }
  return { manager, release }
}

const open = (manager: ExtensionsManager) =>
  render(<ExtensionsFlow width={100} manager={manager} onError={vi.fn()} onClose={vi.fn()} />)
const frame = (f: ReturnType<typeof open>) => f.lastFrame() ?? ''

describe('ExtensionsFlow (M3 · T2)', () => {
  it('installs with the real byte count, never a percentage, then shows it installed', async () => {
    const { manager, release } = fakeManager()
    const f = open(manager)
    await until(() => frame(f).includes('↵ install'))
    expect(frame(f)).toContain('Sharpen · Boost resolution 2× · 4×')

    await tick()
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('6.2 of 15 MB'))
    expect(frame(f)).toContain('Installing')
    expect(frame(f)).not.toMatch(/\d%/)

    release()
    await until(() => frame(f).includes('installed · 15 MB'))
    expect(frame(f)).not.toContain('Installing')
  })

  it('x asks in place; ↵ removes it and the sheet offers the install again', async () => {
    const { manager } = fakeManager({ installed: ['boost'] })
    const f = open(manager)
    await until(() => frame(f).includes('installed · 15 MB'))
    expect(frame(f)).toMatch(/x\]? remove/)

    await tick()
    f.stdin.write('x')
    await until(() => frame(f).includes('Remove it from this Mac?'))
    expect(frame(f)).toContain('Frees 15 MB.')
    expect(frame(f)).toContain('Sharpen and Boost resolution 2× and 4× will offer to download')

    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Removed · 15 MB freed'))
    expect(frame(f)).toContain('↵ install')
    expect(frame(f)).not.toContain('Remove it from this Mac?')
  })

  it('esc at the question keeps the tool, unchanged', async () => {
    const { manager } = fakeManager({ installed: ['boost'] })
    const f = open(manager)
    await until(() => frame(f).includes('installed · 15 MB'))
    const before = frame(f)
    await tick()
    f.stdin.write('x')
    await until(() => frame(f).includes('Remove it from this Mac?'))
    f.stdin.write(ESC)
    await until(() => !frame(f).includes('Remove it from this Mac?'))
    expect(frame(f)).toBe(before)
  })

  it('while another forge runs the tool, x is not offered and the sheet says why', async () => {
    const { manager } = fakeManager({
      installed: ['boost'],
      inUse: { boost: { pid: 1, what: 'Boost resolution 4× is running on portrait.jpg' } },
    })
    const f = open(manager)
    await until(() => frame(f).includes('In use:'))
    expect(frame(f)).toContain('portrait.jpg')
    expect(frame(f)).not.toMatch(/x\]? remove/)

    f.stdin.write('x')
    await tick()
    expect(frame(f)).not.toContain('Remove it from this Mac?')
  })

  it('offers to install one absent extension for its action, then hands control back', async () => {
    const { manager, release } = fakeManager()
    const onInstalled = vi.fn()
    const f = render(
      <ExtensionsFlow
        width={100}
        only="boost"
        manager={manager}
        onInstalled={onInstalled}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await until(() => frame(f).includes('↵ install'))
    expect(frame(f)).not.toContain('Remove background')

    await tick()
    release()
    f.stdin.write(ENTER)
    await until(() => onInstalled.mock.calls.length > 0)
    expect(onInstalled).toHaveBeenCalledWith('boost')
  })
})
