import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { isForgeError } from '../../src/core/errors.js'
import type { ExtensionsJson } from '../../src/core/report-data.js'
import type { CatalogEntry } from '../../src/extensions/catalog.js'

const h = vi.hoisted(() => ({ catalog: [] as CatalogEntry[], release: '24.0.0' }))

vi.mock('../../src/extensions/catalog.js', async (orig) => ({
  // The real lookups, over the test's catalogue.
  ...(await orig<typeof import('../../src/extensions/catalog.js')>()),
  get CATALOG() {
    return h.catalog
  },
  catalogEntry: (id: string) => h.catalog.find((e) => e.id === id),
}))
vi.mock('node:os', async (orig) => ({
  ...(await orig<typeof import('node:os')>()),
  release: () => h.release,
}))

const { installExtension, listExtensions, removeExtension } = await import(
  '../../src/extensions/manager.js'
)
const { installed, extensionsRoot } = await import('../../src/extensions/paths.js')

// Most tests here use Mac assets (`darwin-universal`) and call through the
// CLI, which reads process.platform; pin it so they run unchanged on the
// Windows CI job too (a no-op on a Mac). Windows is tested by passing 'win32'.
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
})
afterAll(() => {
  Object.defineProperty(process, 'platform', realPlatform)
})

// --- fixtures -------------------------------------------------------------

function tarEntry(name: string, body: Buffer, mode = 0o644): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100)
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.fill(' ', 148, 156)
  const sum = header.reduce((a, b) => a + b, 0)
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512)
  return Buffer.concat([header, body, pad])
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/**
 * A payload archive: manifest + one executable. `lie` makes the manifest hash
 * wrong; `listed` adds a file to the manifest that is not in the archive.
 */
function payload(
  version: string,
  opts: { lie?: boolean; extraName?: string; listed?: string } = {},
): Buffer {
  const bin = Buffer.from(`#!/bin/sh\necho ${version}\n`)
  const manifest = {
    id: 'remove-background',
    version,
    arch: 'universal',
    files: {
      'forge-cutout': opts.lie ? sha(Buffer.from('other')) : sha(bin),
      ...(opts.listed ? { [opts.listed]: sha(bin) } : {}),
    },
    entry: 'forge-cutout',
    kind: 'exec',
  }
  const parts = [
    tarEntry('manifest.json', Buffer.from(JSON.stringify(manifest))),
    tarEntry('forge-cutout', bin, 0o755),
  ]
  if (opts.extraName) parts.push(tarEntry(opts.extraName, Buffer.from('x')))
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]))
}

let server: Server
let base: string
const routes = new Map<string, Buffer>()

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = routes.get(req.url ?? '')
    if (body === undefined) {
      res.writeHead(404).end()
    } else if (req.url?.startsWith('/oversized')) {
      // More bytes than the catalogue says the asset has.
      res.writeHead(200).end(Buffer.concat([body, Buffer.alloc(4096)]))
    } else if (req.url?.startsWith('/cut-short')) {
      // Promise the full length, send half, then drop the connection.
      res.writeHead(200, { 'content-length': body.length })
      res.write(body.subarray(0, body.length / 2))
      setTimeout(() => res.destroy(), 20)
    } else {
      res.writeHead(200, { 'content-length': body.length }).end(body)
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise((r) => server.close(r)))

function entryFor(
  version: string,
  archive: Buffer,
  path: string,
  sha256 = sha(archive),
): CatalogEntry {
  routes.set(path, archive)
  return {
    id: 'remove-background',
    title: 'Remove background',
    summary: 's',
    minMacos: 14,
    assets: {
      'darwin-universal': { version, url: `${base}${path}`, bytes: archive.length, sha256 },
    },
    licence: 'l',
  }
}

let config: string
const savedXdg = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), 'forge-ext-'))
  process.env.XDG_CONFIG_HOME = config
  h.release = '24.0.0'
  routes.clear()
})
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
  await rm(config, { recursive: true, force: true })
})

/** Everything under the root but the lock directory, which stays (empty) once used. */
async function leftovers(): Promise<string[]> {
  return (await readdir(extensionsRoot(), { recursive: true }).catch(() => []))
    .filter((p) => !p.startsWith('.locks'))
    .sort()
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

// --- install --------------------------------------------------------------

describe('installing an extension', () => {
  it('downloads, verifies and installs a runnable payload, reporting real bytes', async () => {
    const archive = payload('1.0.0')
    h.catalog = [entryFor('1.0.0', archive, '/v1.tgz')]
    const seen: Array<[number, number]> = []
    const ext = await installExtension('remove-background', {
      onProgress: (done, total) => seen.push([done, total]),
    })

    expect(ext.version).toBe('1.0.0')
    expect(ext.kind).toBe('exec')
    expect((await stat(ext.entry)).mode & 0o111).not.toBe(0)
    expect(await installed('remove-background')).toEqual(ext)
    expect(seen.at(-1)).toEqual([archive.length, archive.length])
    // No download or staging debris: only the version and the pointer remain.
    expect(await leftovers()).toEqual(
      [
        'remove-background',
        'remove-background/1.0.0',
        'remove-background/1.0.0/forge-cutout',
        'remove-background/1.0.0/manifest.json',
        'remove-background/current',
      ].sort(),
    )
  })

  it('installs an archive made by scripts/package-extension.mjs, long paths included', async () => {
    const work = await mkdtemp(join(tmpdir(), 'forge-pkg-'))
    try {
      const payloadDir = join(work, 'payload')
      // Past ustar's 100-byte name field, so the packager must use the prefix field.
      const deep = `${'models/'.repeat(16)}weights.bin`
      expect(deep.length).toBeGreaterThan(100)
      await mkdir(join(payloadDir, deep, '..'), { recursive: true })
      await writeFile(join(payloadDir, deep), Buffer.alloc(900, 3))
      await writeFile(join(payloadDir, 'forge-cutout'), '#!/bin/sh\necho hi\n')
      await chmod(join(payloadDir, 'forge-cutout'), 0o755)
      const made = JSON.parse(
        execFileSync(
          'node',
          [
            join(process.cwd(), 'scripts/package-extension.mjs'),
            'remove-background',
            '1.0.0',
            'universal',
            payloadDir,
            join(work, 'out'),
          ],
          { encoding: 'utf8' },
        ),
      ) as { asset: string }
      const archive = await readFile(join(work, 'out', made.asset))
      h.catalog = [entryFor('1.0.0', archive, `/${made.asset}`)]

      const ext = await installExtension('remove-background')
      expect(await readFile(join(ext.entry, '..', deep))).toEqual(Buffer.alloc(900, 3))
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })

  it('a download that does not match its checksum is extension-corrupt and leaves nothing', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz', sha(Buffer.from('expected')))]
    expect(await codeOf(installExtension('remove-background'))).toBe('extension-corrupt')
    expect(await leftovers()).toEqual([])
    expect(await installed('remove-background')).toBeUndefined()
  })

  it('a file that disagrees with the archive manifest is extension-corrupt', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0', { lie: true }), '/v1.tgz')]
    expect(await codeOf(installExtension('remove-background'))).toBe('extension-corrupt')
    expect(await leftovers()).toEqual([])
  })

  it('an archive entry that climbs out of the install directory is refused', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0', { extraName: '../escape' }), '/v1.tgz')]
    expect(await codeOf(installExtension('remove-background'))).toBe('extension-corrupt')
    // `../escape` from `<id>/.staging-*` would land in `<id>/escape`.
    await expect(
      access(join(config, 'forge', 'extensions', 'remove-background', 'escape')),
    ).rejects.toThrow()
    expect(await leftovers()).toEqual([])
  })

  it('a manifest path that is a Windows separator or drive is refused', async () => {
    // Harmless on a Mac (one odd file name), but `..\\` climbs out on Windows.
    h.catalog = [entryFor('1.0.0', payload('1.0.0', { listed: '..\\evil.dll' }), '/v1.tgz')]
    const err = await installExtension('remove-background').catch((e: unknown) => e)
    expect(isForgeError(err) && err.detail).toBe('remove-background: unsafe path ..\\evil.dll')
    expect(await leftovers()).toEqual([])
  })

  it('a connection that drops mid-download is extension-download-failed and leaves nothing', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/cut-short.tgz')]
    expect(await codeOf(installExtension('remove-background'))).toBe('extension-download-failed')
    expect(await leftovers()).toEqual([])
  })

  it('an unreachable server is extension-download-failed', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect(await codeOf(installExtension('remove-background', { fetchImpl }))).toBe(
      'extension-download-failed',
    )
  })

  it('stops a download that runs past its published size', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/oversized.tgz')]
    const err = await installExtension('remove-background').catch((e: unknown) => e)
    expect(isForgeError(err) && err.detail).toBe(
      'remove-background: the download is larger than its published size.',
    )
    expect(await leftovers()).toEqual([])
  })

  it('names the mirror it could not reach when FORGE_EXTENSIONS_BASE_URL is set', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    vi.stubEnv('FORGE_EXTENSIONS_BASE_URL', 'https://mirror.example.com/forge')
    try {
      const err = await installExtension('remove-background', { fetchImpl }).catch((e) => e)
      expect(isForgeError(err) && err.detail).toBe(
        'remove-background: could not reach mirror.example.com.',
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('sweeps stale debris from an interrupted install, but not a live one', async () => {
    const root = extensionsRoot()
    const old = new Date(Date.now() - 60 * 60 * 1000)
    await mkdir(join(root, 'remove-background', '.staging-y'), { recursive: true })
    await writeFile(join(root, '.download-x.tar.gz'), 'partial')
    await writeFile(join(root, '.download-live.tar.gz'), 'in progress elsewhere')
    await utimes(join(root, 'remove-background', '.staging-y'), old, old)
    await utimes(join(root, '.download-x.tar.gz'), old, old)

    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    await installExtension('remove-background')
    const left = await leftovers()
    expect(left).not.toContain('.download-x.tar.gz')
    expect(left).not.toContain('remove-background/.staging-y')
    expect(left).toContain('.download-live.tar.gz')
  })

  it('an unknown id is a usage error', async () => {
    h.catalog = []
    expect(await codeOf(installExtension('nope'))).toBe('invalid-arguments')
  })
})

describe('updating', () => {
  it('replaces the old version once the new one is in place', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    await installExtension('remove-background')

    h.catalog = [entryFor('1.1.0', payload('1.1.0'), '/v2.tgz')]
    const [status] = await listExtensions()
    expect(status).toMatchObject({ installed: '1.0.0', updateAvailable: true })

    const ext = await installExtension('remove-background')
    expect(ext.version).toBe('1.1.0')
    expect(await readdir(join(extensionsRoot(), 'remove-background'))).toEqual(['1.1.0', 'current'])
    expect((await listExtensions())[0]).toMatchObject({
      installed: '1.1.0',
      updateAvailable: false,
    })
  })

  it('a failed update leaves the working version untouched', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    const before = await installExtension('remove-background')

    h.catalog = [entryFor('1.1.0', payload('1.1.0'), '/v2.tgz', sha(Buffer.from('wrong')))]
    expect(await codeOf(installExtension('remove-background'))).toBe('extension-corrupt')
    expect(await installed('remove-background')).toEqual(before)
    expect(await readFile(before.entry, 'utf8')).toContain('1.0.0')
  })
})

describe('removing', () => {
  it('deletes the extension, and says so when there was nothing to delete', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    await installExtension('remove-background')
    expect(await removeExtension('remove-background')).toBe(true)
    expect(await installed('remove-background')).toBeUndefined()
    expect(await leftovers()).toEqual([])
    expect(await removeExtension('remove-background')).toBe(false)
  })

  it('does not say it removed anything when only install debris was there', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    await mkdir(join(extensionsRoot(), 'remove-background', '.staging-y'), { recursive: true })
    expect(await removeExtension('remove-background')).toBe(false)
    expect(await leftovers()).toEqual([])
  })
})

// --- listing --------------------------------------------------------------

describe('listing', () => {
  it('works offline: it never touches the network', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    const net = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const [s] = await listExtensions()
    expect(s).toMatchObject({ supported: true, updateAvailable: false })
    expect(s?.installed).toBeUndefined()
    expect(s?.downloadBytes).toBeGreaterThan(0)
    expect(net).not.toHaveBeenCalled()
    net.mockRestore()
  })

  it('reports macOS older than the minimum, and refuses to install there', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    h.release = '22.6.0' // macOS 13
    const [s] = await listExtensions()
    expect(s).toMatchObject({ supported: false, reason: 'needs macOS 14 or later' })
    expect(await installExtension('remove-background').catch((e: unknown) => e)).toMatchObject({
      code: 'extension-unsupported',
      detail: 'remove-background cannot be installed on this Mac: needs macOS 14 or later',
    })
    expect(await leftovers()).toEqual([])
  })

  it('reports an architecture with no build', async () => {
    const entry = entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')
    const { 'darwin-universal': universal, ...rest } = entry.assets
    h.catalog = [{ ...entry, assets: { ...rest, 'darwin-x64': universal } }]
    const arch = Object.getOwnPropertyDescriptor(process, 'arch') as PropertyDescriptor
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    try {
      expect((await listExtensions())[0]).toMatchObject({ supported: false })
      expect(await codeOf(installExtension('remove-background'))).toBe('extension-unsupported')
    } finally {
      Object.defineProperty(process, 'arch', arch)
    }
  })
})

describe('listing on Windows', () => {
  it('lists only what has a Windows build, and names a chip with none', async () => {
    const mac = entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')
    const asset = {
      version: '1.1.0',
      url: `${base}/w.tgz`,
      bytes: 60,
      sha256: sha(Buffer.from('w')),
    }
    h.catalog = [{ ...mac, id: 'boost', minMacos: undefined, assets: { 'win32-x64': asset } }, mac]

    expect(await listExtensions('win32', 'x64')).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ id: 'boost' }),
        supported: true,
        downloadBytes: 60,
      }),
    ])
    expect((await listExtensions('win32', 'arm64'))[0]).toMatchObject({
      supported: false,
      reason: 'no build for arm64 PCs',
    })
  })

  it('refuses an extension with no Windows build by name, and a chip with none as a PC', async () => {
    const mac = entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')
    const asset = { version: '1.1.0', url: `${base}/w.tgz`, bytes: 60, sha256: 'x' }
    h.catalog = [{ ...mac, id: 'boost', minMacos: undefined, assets: { 'win32-x64': asset } }, mac]
    const refusal = (id: string, arch: string) =>
      installExtension(id, { platform: 'win32', arch }).catch((e: unknown) => e)

    expect(await refusal('remove-background', 'x64')).toMatchObject({
      code: 'extension-unsupported',
      detail: 'Remove background is not available on Windows.',
    })
    expect(await refusal('boost', 'arm64')).toMatchObject({
      code: 'extension-unsupported',
      detail: 'boost cannot be installed on this PC: no build for arm64 PCs',
    })
    expect(await leftovers()).toEqual([])
  })
})

// --- the command ----------------------------------------------------------

describe('forge extensions', () => {
  it('parses list, add and remove, and refuses malformed forms', () => {
    expect(parseArgs(['extensions'])).toEqual({ kind: 'extensions', action: 'list' })
    expect(parseArgs(['extensions', 'add', 'boost', '--json'])).toEqual({
      kind: 'extensions',
      action: 'add',
      id: 'boost',
    })
    expect(parseArgs(['extensions', 'remove', 'boost'])).toMatchObject({ action: 'remove' })
    for (const bad of [['add'], ['frob'], ['add', 'a', 'b'], ['--to', 'png']]) {
      expect(() => parseArgs(['extensions', ...bad])).toThrow()
    }
  })

  it('add --json reports the installed state; a failed download exits 1, an unknown id 2', async () => {
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/v1.tgz')]
    const ok = await execute(
      { kind: 'extensions', action: 'add', id: 'remove-background' },
      { json: true },
    )
    const doc = JSON.parse(ok.stdout[0] ?? '') as ExtensionsJson
    expect(ok.exitCode).toBe(0)
    expect(doc).toMatchObject({
      ok: true,
      changed: { id: 'remove-background', action: 'added' },
      failures: [],
    })
    expect(doc.extensions[0]).toMatchObject({ id: 'remove-background', installed: '1.0.0' })

    await execute({ kind: 'extensions', action: 'remove', id: 'remove-background' })
    h.catalog = [entryFor('1.0.0', payload('1.0.0'), '/cut-short.tgz')]
    const dropped = await execute(
      { kind: 'extensions', action: 'add', id: 'remove-background' },
      { json: true },
    )
    expect(dropped.exitCode).toBe(1)
    expect(JSON.parse(dropped.stdout[0] ?? '').failures[0].code).toBe('extension-download-failed')

    const unknown = await execute({ kind: 'extensions', action: 'add', id: 'nope' }, { json: true })
    expect(unknown.exitCode).toBe(2)
  })
})
