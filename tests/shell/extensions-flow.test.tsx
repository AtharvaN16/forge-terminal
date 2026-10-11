import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { CATALOG } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { ExtensionsFlow, type ExtensionsManager } from '../../src/shell/flows/extensions.js'

const ENTER = String.fromCharCode(13)
const tick = () => new Promise((r) => setTimeout(r, 50))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

/** An in-memory manager: install blocks on `gate` so the test sees the in-flight frame. */
function fakeManager() {
  const have = new Set<string>()
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const manager: ExtensionsManager = {
    async list() {
      return CATALOG.map(
        (entry): ExtensionStatus => ({
          entry,
          ...(have.has(entry.id) ? { installed: entry.version } : {}),
          updateAvailable: false,
          supported: true,
          downloadBytes: 4_000_000,
        }),
      )
    },
    async install(id, { onProgress }) {
      onProgress(1_000_000, 4_000_000)
      await gate
      have.add(id)
    },
    async remove() {
      return true
    },
  }
  return { manager, release }
}

describe('ExtensionsFlow', () => {
  it('lists the catalogue, shows real byte progress while installing, then flips to installed', async () => {
    const { manager, release } = fakeManager()
    const f = render(
      <ExtensionsFlow width={100} manager={manager} onError={vi.fn()} onClose={vi.fn()} />,
    )
    await until(() => (f.lastFrame() ?? '').includes('not installed'))
    expect(f.lastFrame()).toContain('Boost')
    expect(f.lastFrame()).toContain('Remove background')

    await tick()
    f.stdin.write(ENTER)
    await until(() => (f.lastFrame() ?? '').includes('25%'))
    expect(f.lastFrame()).toContain('Installing 25%')
    expect(f.lastFrame()).toContain('of')

    release()
    await until(() => (f.lastFrame() ?? '').includes('installed v'))
    expect(f.lastFrame()).toContain(`installed v${CATALOG[0]?.version}`)
    expect(f.lastFrame()).not.toContain('Installing')
  })

  it('offers to install an absent extension for its action, then hands control back', async () => {
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
    await until(() => (f.lastFrame() ?? '').includes('not installed'))
    expect(f.lastFrame()).toContain('install it?')
    expect(f.lastFrame()).not.toContain('Remove background')
    expect(onInstalled).not.toHaveBeenCalled()

    await tick()
    release()
    f.stdin.write(ENTER)
    await until(() => onInstalled.mock.calls.length > 0)
    expect(onInstalled).toHaveBeenCalledWith('boost')
  })
})
