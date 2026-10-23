import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assetFor, CATALOG, catalogEntry, offeredHere } from '../../src/extensions/catalog.js'
import { editRows } from '../../src/shell/edit.js'

// macOS 15, whatever this machine runs: the Mac listing is pinned on any CI host.
vi.mock('node:os', async (orig) => ({
  ...(await orig<typeof import('node:os')>()),
  release: () => '24.0.0',
}))

const { listExtensions } = await import('../../src/extensions/manager.js')
const { extensionsRoot } = await import('../../src/extensions/paths.js')

const RELEASES = 'https://github.com/AtharvaN16/forge-terminal/releases/download'

let config: string
const savedXdg = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), 'forge-cat-'))
  process.env.XDG_CONFIG_HOME = config
})
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
  await rm(config, { recursive: true, force: true })
})

describe('the Mac catalogue, as published', () => {
  it('offers boost and remove-background on Apple Silicon with the released archives', async () => {
    const list = (await listExtensions('darwin', 'arm64')).filter((s) => s.entry.id !== 'yt-dlp')
    expect(list.map((s) => s.entry.id)).toEqual(['boost', 'remove-background'])
    expect(list.every((s) => s.supported)).toBe(true)
    const [boost, cutout] = list.map((s) => assetFor(s.entry, 'darwin', 'arm64'))
    expect(boost).toEqual({
      version: '1.0.0',
      url: `${RELEASES}/ext-boost-v1.0.0/forge-ext-boost-1.0.0-arm64.tar.gz`,
      bytes: 14866325,
      sha256: '7af24c92f95b1cd34618adde4a90926c91a8db4347d640be4921f1dc706a9a2e',
    })
    expect(cutout).toEqual({
      version: '1.0.0',
      url: `${RELEASES}/ext-remove-background-v1.0.0/forge-ext-remove-background-1.0.0-universal.tar.gz`,
      bytes: 32489,
      sha256: '9f6e055c0ce25f7504e10c7871e506a813bc75d6536396a675a8c075c4eb4686',
    })
  })

  it("lists yt-dlp as upstream's own pinned release, for macOS 26 and later", async () => {
    const yt = (await listExtensions('darwin', 'arm64')).find((s) => s.entry.id === 'yt-dlp')
    // This file pins macOS 15.
    expect(yt).toMatchObject({ supported: false, reason: 'needs macOS 26 or later' })
    expect(yt && assetFor(yt.entry, 'darwin', 'arm64')).toEqual({
      version: '2026.08.19',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos',
      bytes: 37146048,
      sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
      binary: 'yt-dlp',
    })
  })

  it('tells an Intel Mac there is no boost build', async () => {
    const boost = (await listExtensions('darwin', 'x64')).find((s) => s.entry.id === 'boost')
    expect(boost).toMatchObject({ supported: false, reason: 'no build for x64 Macs' })
  })

  it('an installed boost 1.0.0 is up to date', async () => {
    const dir = join(extensionsRoot(), 'boost', '1.0.0')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'runner.mjs'), '')
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'boost',
        version: '1.0.0',
        files: { 'runner.mjs': '' },
        entry: 'runner.mjs',
        kind: 'node',
      }),
    )
    await writeFile(join(extensionsRoot(), 'boost', 'current'), '1.0.0\n')
    const boost = (await listExtensions('darwin', 'arm64')).find((s) => s.entry.id === 'boost')
    expect(boost).toMatchObject({ installed: '1.0.0', updateAvailable: false })
  })
})

describe('by OS', () => {
  it('remove-background is Mac-only, heic is never offered on a Mac', () => {
    expect(offeredHere('remove-background', 'darwin')).toBe(true)
    expect(offeredHere('remove-background', 'win32')).toBe(false)
    expect(offeredHere('heic', 'darwin')).toBe(false)
    expect(CATALOG.map((e) => e.id)).toContain('heic')
  })

  it('heic is offered on Windows and Linux, one build for any chip', () => {
    expect(offeredHere('heic', 'win32')).toBe(true)
    expect(offeredHere('heic', 'linux')).toBe(true)
    const heic = catalogEntry('heic')
    if (heic === undefined) throw new Error('heic is catalogued')
    for (const arch of ['x64', 'arm64']) {
      expect(assetFor(heic, 'linux', arch)?.url).toMatch(
        /forge-ext-heic-1\.0\.0-linux-universal\.tar\.gz$/,
      )
      expect(assetFor(heic, 'win32', arch)?.url).toMatch(/-win32-universal\.tar\.gz$/)
    }
  })

  it('Edit has no Remove background row where it is not offered', () => {
    const photo = {
      kind: 'image',
      path: '/p.png',
      format: 'png',
      bytes: 1,
      width: 100,
      height: 100,
      hasAlpha: false,
      frames: 1,
    } as const
    expect(editRows(photo, undefined, undefined, 'darwin').map((r) => r.id)).toContain('cutout')
    expect(editRows(photo, undefined, undefined, 'win32').map((r) => r.id)).not.toContain('cutout')
  })
})
