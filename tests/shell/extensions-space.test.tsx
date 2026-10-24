import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { ExtensionsFlow, type ExtensionsManager } from '../../src/shell/flows/extensions.js'
import { sizeOf, spaceRows } from '../../src/shell/space-art.js'
import { DARK } from '../../src/shell/theme.js'

const DOWN = `${String.fromCharCode(27)}[B`
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}
const MB = 1_000_000
const BASE = CATALOG.find((e) => offeredOn(e, 'darwin')) as (typeof CATALOG)[number]

/** `n` tools, the first `installed` of them on this Mac at 15 MB each. */
function manager(n: number, installed: number, forge?: number): ExtensionsManager {
  return {
    async list() {
      return Array.from(
        { length: n },
        (_, i): ExtensionStatus => ({
          entry: { ...BASE, id: `tool-${i + 1}` as typeof BASE.id, title: `Tool ${i + 1}` },
          ...(i < installed ? { installed: '1.0.0', installedBytes: 15 * MB } : {}),
          updateAvailable: false,
          supported: true,
          downloadBytes: 15 * MB,
        }),
      )
    },
    async install() {},
    async remove() {
      return true
    },
    async inUse() {
      return undefined
    },
    ...(forge === undefined ? {} : { forgeBytes: async () => forge }),
  }
}

const open = (m: ExtensionsManager, height: number | null = 13) =>
  render(
    <ExtensionsFlow
      width={100}
      {...(height === null ? {} : { height })}
      platform="darwin"
      manager={m}
      onError={vi.fn()}
      onClose={vi.fn()}
    />,
  )

/** The list's rows: the frame's column, below the bar and its gap. */
const listOf = (out: string) =>
  out
    .split('\n')
    .slice(2)
    .map((l) => l.slice(0, 29).trimEnd())

describe('/extensions: the list and the space taken, one frame (round 10)', () => {
  it('ends the frame with Forge against its extensions, on the frame’s last two rows', async () => {
    const f = open(manager(4, 2, 34.5 * MB))
    await until(() => (f.lastFrame() ?? '').includes('Forge'))
    const rows = listOf(f.lastFrame() ?? '')
    // A row of room, the four tools, then the box on rows 12 and 13 of 13.
    expect(rows[1]).toMatch(/▌ Tool 1/)
    expect(rows[11]).toMatch(/^\s*Forge\s+Extensions$/)
    expect(rows[12]).toMatch(/^\s*35 MB\s+30 MB$/)
    expect(rows[10]).toBe('')
  })

  it('draws no rule between the list and the sheet', async () => {
    const f = open(manager(4, 2, 34.5 * MB))
    await until(() => (f.lastFrame() ?? '').includes('Forge'))
    expect(f.lastFrame()).not.toContain('│')
  })

  it('shows no box until Forge’s own size is known', async () => {
    const f = open(manager(4, 2))
    await until(() => (f.lastFrame() ?? '').includes('Tool 4'))
    expect(f.lastFrame()).not.toContain('Forge')
  })

  it('scrolls a long list inside the frame, saying how many are below', async () => {
    const f = open(manager(16, 2, 34.5 * MB))
    await until(() => (f.lastFrame() ?? '').includes('Forge'))
    // 13 rows: a row of room, 8 tools, "↓ 8 more", a gap, the box.
    let rows = listOf(f.lastFrame() ?? '')
    expect(rows[8]).toMatch(/Tool 8/)
    expect(rows[9]).toMatch(/↓ 8 more$/)
    expect(rows[12]).toMatch(/35 MB/)

    for (let i = 0; i < 9; i++) {
      f.stdin.write(DOWN)
      await new Promise((r) => setTimeout(r, 20))
    }
    // The cursor on tool 10 stays in sight, at the window's foot.
    rows = listOf(f.lastFrame() ?? '')
    expect(rows[8]).toMatch(/▌ Tool 10/)
    expect(rows[9]).toMatch(/↓ 6 more$/)
    expect(f.lastFrame()).not.toContain('Tool 2 ')

    for (let i = 0; i < 9; i++) {
      f.stdin.write(DOWN)
      await new Promise((r) => setTimeout(r, 20))
    }
    rows = listOf(f.lastFrame() ?? '')
    expect(rows[8]).toMatch(/▌ Tool 16/)
    expect(rows[9]).toBe('')
  })

  it('lists every tool when the menu gives no height', async () => {
    const f = open(manager(16, 2, 34.5 * MB), null)
    await until(() => (f.lastFrame() ?? '').includes('Forge'))
    expect(f.lastFrame()).toContain('Tool 16')
    expect(f.lastFrame()).not.toContain('more')
  })
})

describe('spaceRows', () => {
  const cells = (row: ReturnType<typeof spaceRows>[number]) =>
    row.reduce((n, r) => n + r.text.length, 0)

  it('splits the frame’s width by size, the parts tinted in their colours', () => {
    const [names, sizes] = spaceRows(DARK, 34.5 * MB, 52 * MB, 27)
    expect(cells(names ?? [])).toBe(27)
    expect(cells(sizes ?? [])).toBe(27)
    expect(names?.[0]?.text).toBe(' Forge     ')
    expect(names?.[1]?.text.trim()).toBe('Extensions')
    expect(names?.[1]?.fg).toBe(DARK.modeConvert)
    expect(names?.[0]?.bg).not.toBe(names?.[1]?.bg)
  })

  it('keeps each part wide enough for its words, however lopsided the split', () => {
    const [names] = spaceRows(DARK, 35 * MB, 0, 27)
    expect(names?.[1]?.text).toBe(' Extensions ')
    const [few] = spaceRows(DARK, 1, 900 * MB, 27)
    expect(few?.[0]?.text).toBe(' Forge ')
  })

  it('sizes whole megabytes from 1 MB, the exact unit below', () => {
    expect(sizeOf(34.5 * MB)).toBe('35 MB')
    expect(sizeOf(32_489)).toBe('32.5 KB')
    expect(sizeOf(0)).toBe('0 B')
  })
})
