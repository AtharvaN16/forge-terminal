import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { assetFor, CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import type { OwnCopy } from '../../src/extensions/own.js'
import {
  ExtensionsFlow,
  type ExtensionsManager,
  type OwnManager,
} from '../../src/shell/flows/extensions.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}
const MB = 1_000_000
const MINE: OwnCopy = {
  id: 'yt-dlp',
  path: '/opt/homebrew/bin/yt-dlp',
  version: '2026.10.03',
  homebrew: true,
  tooOld: false,
}

function fake(opts: {
  quick?: OwnCopy
  deep?: OwnCopy
  probe?: (path: string) => OwnCopy | undefined
  newer?: string
  /** Nobody could say whether there is a newer version. */
  unknown?: boolean
  forgeInstalled?: boolean
}) {
  let forge = opts.forgeInstalled ?? false
  const calls = { choose: [] as string[], update: 0, install: 0 }
  const own: OwnManager = {
    async find(id, deep) {
      if (id !== 'yt-dlp') return undefined
      return deep ? opts.deep : opts.quick
    },
    async probe(_id, path) {
      return opts.probe?.(path)
    },
    async choose(_id, path) {
      calls.choose.push(path)
    },
    async removeForgeCopy(id) {
      if (id !== 'yt-dlp' || !forge) return 0
      forge = false
      return 37.1 * MB
    },
    async newer() {
      return opts.unknown ? undefined : (opts.newer ?? null)
    },
    async update() {
      calls.update++
    },
  }
  const manager: ExtensionsManager = {
    async list() {
      return CATALOG.filter((e) => offeredOn(e, 'darwin') || e.id === 'video').map(
        (entry): ExtensionStatus => {
          const offered = offeredOn(entry, 'darwin')
          const have = entry.id === 'yt-dlp' && forge
          return {
            entry,
            ...(have
              ? { installed: assetFor(entry, 'darwin')?.version, installedBytes: 37.1 * MB }
              : {}),
            updateAvailable: false,
            supported: offered,
            ...(offered ? { downloadBytes: 37.1 * MB } : {}),
          }
        },
      )
    },
    async install() {
      calls.install++
    },
    async remove() {
      return true
    },
    async inUse() {
      return undefined
    },
    own,
  }
  return { manager, calls }
}

async function openOn(manager: ExtensionsManager, name: string) {
  const f = render(
    <ExtensionsFlow
      width={100}
      platform="darwin"
      manager={manager}
      onError={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  await until(() => (f.lastFrame() ?? '').includes(name))
  for (let i = 0; i < 6 && !new RegExp(`▌ ${name}`).test(f.lastFrame() ?? ''); i++) {
    f.stdin.write(DOWN)
    await new Promise((r) => setTimeout(r, 30))
  }
  return f
}
const frame = (f: { lastFrame(): string | undefined }) => f.lastFrame() ?? ''

describe('/extensions — a tool the user has themselves', () => {
  it('uses theirs by itself: the card says so, and Forge’s copy is removed', async () => {
    const { manager } = fake({ quick: MINE, forgeInstalled: true })
    const f = await openOn(manager, 'YouTube links')
    await until(() => frame(f).includes('Uses your copy'))
    const out = frame(f)
    expect(out).toContain('Transcribe YouTube videos')
    expect(out).not.toContain('yt-dlp fetches their sound')
    expect(out).toMatch(/╭─ yt-dlp ─/)
    expect(out).toMatch(/Path {6}\/opt\/homebrew\/bin\/yt-dlp/)
    expect(out).toContain('2026.10.03 · latest')
    expect(out).toContain("Forge's copy removed · 37.1 MB freed")
    expect(out).not.toContain('↵ install')
    expect(out).toMatch(/YouTube links\s+✓/)
    // Header, a blank row, then the card: the gap keeps the levels apart.
    expect(out).toMatch(/Transcribe YouTube videos *\n.{0,30}\n.*╭─ yt-dlp/)
  })

  it('never says latest when nobody could say', async () => {
    const { manager } = fake({ quick: MINE, unknown: true })
    const f = await openOn(manager, 'YouTube links')
    await until(() => frame(f).includes('Uses your copy'))
    await new Promise((r) => setTimeout(r, 60))
    expect(frame(f)).toMatch(/Version {3}2026\.10\.03 /)
    expect(frame(f)).not.toContain('latest')
  })

  it('↵ on theirs installs nothing of Forge’s', async () => {
    const { manager, calls } = fake({ quick: MINE })
    const f = await openOn(manager, 'YouTube links')
    await until(() => frame(f).includes('Uses your copy'))
    f.stdin.write(ENTER)
    await new Promise((r) => setTimeout(r, 60))
    expect(calls.install).toBe(0)
  })

  it('not found by itself: Already have yt-dlp? — c checks this Mac, ↵ uses what it found', async () => {
    const { manager, calls } = fake({ deep: { ...MINE, path: '/Users/x/.local/bin/yt-dlp' } })
    const f = await openOn(manager, 'YouTube links')
    expect(frame(f)).toContain('Not installed')
    expect(frame(f)).toContain('37.1 MB download')
    expect(frame(f)).toContain('Already have yt-dlp?')
    expect(frame(f)).toContain('↵ install')
    f.stdin.write('c')
    await until(() => frame(f).includes('Found on this Mac'))
    expect(frame(f)).toContain('↵ use it')
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Uses your copy'))
    expect(calls.choose).toEqual(['/Users/x/.local/bin/yt-dlp'])
  })

  it('still not found: Path takes a dropped or typed file; a wrong one says so', async () => {
    const good = { ...MINE, path: '/tools/yt-dlp', homebrew: false }
    const { manager, calls } = fake({ probe: (p) => (p === '/tools/yt-dlp' ? good : undefined) })
    const f = await openOn(manager, 'YouTube links')
    f.stdin.write('c')
    await until(() => frame(f).includes('Not found on this Mac'))
    expect(frame(f)).toContain('Drop it here, or type it')
    f.stdin.write('/nope')
    await until(() => frame(f).includes('/nope'))
    expect(frame(f)).toContain('↵ use it')
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Nothing there runs as yt-dlp'))
    f.stdin.write(ESC)
    await until(() => frame(f).includes('Drop it here, or type it'))
    f.stdin.write('/tools/yt-dlp')
    await new Promise((r) => setTimeout(r, 40))
    f.stdin.write(ENTER)
    await until(() => frame(f).includes('Uses your copy'))
    expect(calls.choose).toEqual(['/tools/yt-dlp'])
    expect(frame(f)).toMatch(/Version {3}2026\.10\.03\s/)
  })

  it('a newer version: one key updates theirs, with its clock', async () => {
    const { manager, calls } = fake({ quick: MINE, newer: '2026.11.02' })
    const f = await openOn(manager, 'YouTube links')
    await until(() => frame(f).includes('2026.11.02 available'))
    expect(frame(f)).toContain('↵ update')
    expect(frame(f)).toMatch(/YouTube links\s+update/)
    f.stdin.write(ENTER)
    await until(() => calls.update === 1)
  })

  it('lists Video and audio, with no download of Forge’s: only the check', async () => {
    const { manager } = fake({})
    const f = await openOn(manager, 'Video and audio')
    expect(frame(f)).toMatch(/╭─ ffmpeg ─/)
    expect(frame(f)).toContain('Already have ffmpeg?')
    expect(frame(f)).not.toContain('↵ install')
  })
})
