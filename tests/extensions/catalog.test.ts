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
    const list = (await listExtensions('darwin', 'arm64')).filter(
      (s) => s.entry.id === 'boost' || s.entry.id === 'remove-background',
    )
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

  it("lists yt-dlp as upstream's own pinned release, for macOS 13 and later", async () => {
    const yt = (await listExtensions('darwin', 'arm64')).find((s) => s.entry.id === 'yt-dlp')
    // This file pins macOS 15: transcribe works there through whisper.cpp, so links do too.
    expect(yt).toMatchObject({ supported: true })
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
  it("remove-background is the Mac's alone until a model passes; heic is never offered on a Mac", () => {
    expect(offeredHere('remove-background', 'darwin')).toBe(true)
    for (const os of ['win32', 'linux'] as const)
      expect(offeredHere('remove-background', os)).toBe(false)
    expect(offeredHere('heic', 'darwin')).toBe(false)
    expect(CATALOG.map((e) => e.id)).toContain('heic')
  })

  it("yt-dlp is upstream's own 2026.08.19 build on every OS and chip", () => {
    const yt = catalogEntry('yt-dlp')
    if (yt === undefined) throw new Error('yt-dlp is catalogued')
    const files = {
      'darwin-arm64': 'yt-dlp_macos',
      'darwin-x64': 'yt-dlp_macos',
      'linux-x64': 'yt-dlp_linux',
      'linux-arm64': 'yt-dlp_linux_aarch64',
      'win32-x64': 'yt-dlp.exe',
      'win32-arm64': 'yt-dlp_arm64.exe',
    }
    for (const [key, file] of Object.entries(files)) {
      const [platform, arch] = key.split('-') as [NodeJS.Platform, string]
      const asset = assetFor(yt, platform, arch)
      expect(asset?.url, key).toBe(
        `https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/${file}`,
      )
      expect(asset?.version).toBe('2026.08.19')
      // Windows runs a program only by its .exe name.
      expect(asset?.binary).toBe(platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
    }
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

  it('raw is offered on Windows and Linux, never on a Mac (sips), one build for any chip', () => {
    expect(offeredHere('raw', 'darwin')).toBe(false)
    expect(offeredHere('raw', 'win32')).toBe(true)
    expect(offeredHere('raw', 'linux')).toBe(true)
    const raw = catalogEntry('raw')
    if (raw === undefined) throw new Error('raw is catalogued')
    expect(raw).toMatchObject({
      title: 'Camera RAW photos',
      summary: 'Open camera RAW photos',
      licence: 'LibRaw (LGPL-2.1 or CDDL-1.0), via libraw-wasm (ISC)',
    })
    for (const os of ['win32', 'linux'] as const) {
      for (const arch of ['x64', 'arm64']) {
        const asset = assetFor(raw, os, arch)
        expect(asset?.url, `${os}-${arch}`).toBe(
          `${RELEASES}/ext-raw-v1.0.0/forge-ext-raw-1.0.0-${os}-universal.tar.gz`,
        )
        expect(asset?.version).toBe('1.0.0')
        // Pinned to the archives built: a WASM LibRaw, about half a megabyte.
        expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(asset?.bytes).toBeGreaterThan(400_000)
        expect(asset?.bytes).toBeLessThan(1_000_000)
      }
    }
  })

  it('whisper is on every OS, model inside, one archive per OS and chip', async () => {
    for (const os of ['darwin', 'win32', 'linux'] as const)
      expect(offeredHere('whisper', os)).toBe(true)
    const w = catalogEntry('whisper')
    if (w === undefined) throw new Error('whisper is catalogued')
    const files = {
      'darwin-arm64': 'universal',
      'darwin-x64': 'universal',
      'win32-x64': 'win32-x64',
      'win32-arm64': 'win32-arm64',
      'linux-x64': 'linux-x64',
      'linux-arm64': 'linux-arm64',
    }
    for (const [key, file] of Object.entries(files)) {
      const [platform, arch] = key.split('-') as [NodeJS.Platform, string]
      const asset = assetFor(w, platform, arch)
      expect(asset?.url, key).toBe(
        `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-${file}.tar.gz`,
      )
      // The 60 MB model is in every archive.
      expect(asset?.bytes, key).toBeGreaterThan(55_000_000)
      expect(asset?.bytes, key).toBeLessThan(100_000_000)
    }
    const linux = (await listExtensions('linux', 'arm64')).find((s) => s.entry.id === 'whisper')
    expect(linux?.supported).toBe(true)
  })

  it('Edit has a Remove background row only where it is offered: the Mac', () => {
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
    for (const os of ['win32', 'linux', 'freebsd'] as const)
      expect(editRows(photo, undefined, undefined, os).map((r) => r.id)).not.toContain('cutout')
  })
})

describe('the Windows and Linux catalogue', () => {
  it('offers neither boost nor remove-background on Linux: CPU only, and no model passed yet', async () => {
    for (const arch of ['x64', 'arm64']) {
      const ids = (await listExtensions('linux', arch)).map((s) => s.entry.id)
      expect(ids).not.toContain('boost')
      expect(ids).not.toContain('remove-background')
      expect(ids).toEqual(expect.arrayContaining(['heic', 'raw', 'whisper', 'yt-dlp']))
    }
  })

  it('offers boost and heic on Windows, and remove-background only on the Mac', async () => {
    const ids = (await listExtensions('win32', 'x64')).map((s) => s.entry.id)
    expect(ids).toEqual(expect.arrayContaining(['boost', 'heic', 'raw', 'whisper']))
    expect(ids).not.toContain('remove-background')
    const cutout = catalogEntry('remove-background')
    expect(cutout && assetFor(cutout, 'darwin', 'arm64')?.version).toBe('1.0.0')
  })

  it('still tells an Intel Mac there is no boost build', () => {
    const boost = CATALOG.find((e) => e.id === 'boost')
    expect(boost && assetFor(boost, 'darwin', 'x64')).toBeUndefined()
  })
})
