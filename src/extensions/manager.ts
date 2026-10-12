import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzip } from 'node:zlib'
import {
  extensionCorrupt,
  extensionDiskFull,
  extensionDownloadFailed,
  extensionUnsupported,
  invalidArguments,
  isForgeError,
} from '../core/errors.js'
import { formatBytes } from '../core/units.js'
import {
  CATALOG,
  type CatalogAsset,
  type CatalogEntry,
  catalogEntry,
  type ExtensionId,
} from './catalog.js'
import { withExtensionLock } from './lock.js'
import { extensionsRoot, type Installed, installed, SAFE_NAME } from './paths.js'
import { extractTar } from './tar.js'

export interface ExtensionStatus {
  entry: CatalogEntry
  /** The installed version, if any. */
  installed?: string
  updateAvailable: boolean
  supported: boolean
  reason?: string
  downloadBytes?: number
  /** What the installed tool takes on disk now, model cache included: what removing it frees. */
  installedBytes?: number
}

/** The bytes under `dir`, measured, so "frees N" is what removing it really frees. */
async function diskBytes(dir: string): Promise<number> {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, e.name)
    if (e.isDirectory()) total += await diskBytes(path)
    else if (e.isFile()) total += (await stat(path).catch(() => undefined))?.size ?? 0
  }
  return total
}

/** Darwin kernel major -> macOS major. macOS 26 shipped with Darwin 25; before that it was Darwin - 9. */
function macosMajor(): number {
  const darwin = Number.parseInt(release(), 10)
  return darwin >= 25 ? darwin + 1 : darwin - 9
}

function assetFor(entry: CatalogEntry): CatalogAsset | undefined {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  return entry.assets.universal ?? (arch === undefined ? undefined : entry.assets[arch])
}

function supportFor(entry: CatalogEntry): { supported: boolean; reason?: string } {
  if (process.platform !== 'darwin') {
    return { supported: false, reason: 'extensions need macOS' }
  }
  if (macosMajor() < entry.minMacos) {
    return { supported: false, reason: `needs macOS ${entry.minMacos} or later` }
  }
  if (assetFor(entry) === undefined) {
    return { supported: false, reason: `no build for ${process.arch} Macs` }
  }
  return { supported: true }
}

/** Offline and instant: the catalogue is compiled in, installed state is read from disk. */
export async function listExtensions(): Promise<ExtensionStatus[]> {
  return Promise.all(
    CATALOG.map(async (entry) => {
      const have = await installed(entry.id)
      const support = supportFor(entry)
      const status: ExtensionStatus = {
        entry,
        updateAvailable: have !== undefined && have.version !== entry.version,
        supported: support.supported,
      }
      if (have !== undefined) {
        status.installed = have.version
        status.installedBytes = await diskBytes(join(extensionsRoot(), entry.id))
      }
      if (support.reason !== undefined) status.reason = support.reason
      const asset = assetFor(entry)
      if (support.supported && asset !== undefined) status.downloadBytes = asset.bytes
      return status
    }),
  )
}

const gunzipAsync = (buf: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    gunzip(buf, (err, out) => (err ? reject(err) : resolve(out)))
  })

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Checks the staged payload against its own manifest. Throws a plain Error naming the problem. */
async function verifyStaged(dir: string, entry: CatalogEntry): Promise<void> {
  const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >
  if (m.id !== entry.id || m.version !== entry.version) {
    throw new Error('the archive is for a different extension or version')
  }
  const files = m.files
  if (typeof files !== 'object' || files === null) throw new Error('manifest lists no files')
  if (
    (m.kind !== 'node' && m.kind !== 'exec') ||
    typeof m.entry !== 'string' ||
    !(m.entry in files)
  ) {
    throw new Error('manifest has no valid entry')
  }
  for (const [rel, expected] of Object.entries(files)) {
    if (rel.startsWith('/') || rel.split('/').includes('..')) throw new Error(`unsafe path ${rel}`)
    if ((await sha256File(join(dir, rel)).catch(() => undefined)) !== expected) {
      throw new Error(`${rel} does not match the manifest`)
    }
  }
}

async function writeCurrent(base: string, version: string): Promise<void> {
  const tmp = join(base, `.current-${randomBytes(4).toString('hex')}`)
  await writeFile(tmp, `${version}\n`)
  await rename(tmp, join(base, 'current'))
}

/**
 * FORGE_EXTENSIONS_BASE_URL redirects downloads to a mirror or a local test
 * server: the asset's file name is appended to it. The sha256 and size in the
 * catalogue still apply, so a mirror cannot substitute different bytes.
 */
function assetUrl(url: string): string {
  const base = process.env.FORGE_EXTENSIONS_BASE_URL
  if (base === undefined || base === '') return url
  return `${base.replace(/\/+$/, '')}/${url.slice(url.lastIndexOf('/') + 1)}`
}

/** Older than this, a download or staging dir belongs to no running install. */
const STALE_MS = 10 * 60 * 1000

/**
 * Removes what an interrupted install left behind: `<root>/.download-*` and
 * `<root>/<id>/.staging-*`. Age-based — a live install's temp files are
 * younger than any install takes — so two installs at once cannot collide.
 */
async function sweepDebris(root: string): Promise<void> {
  const cutoff = Date.now() - STALE_MS
  const sweep = async (dir: string, prefix: string) => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.startsWith(prefix)) continue
      const path = join(dir, name)
      const age = await stat(path).catch(() => undefined)
      if (age !== undefined && age.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
  await sweep(root, '.download-')
  for (const entry of CATALOG) {
    const base = join(root, entry.id)
    await sweep(base, '.staging-')
    await sweep(base, '.current-')
    // A directory that held only debris goes too.
    await rmdir(base).catch(() => {})
  }
}

/** Something the user can act on: a full disk is not a dropped connection or a bad archive. */
function diskFull(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC'
}

/** The tap's refusal of a download that runs past its published size. */
class TooLarge extends Error {}

/**
 * Download, verify, extract, swap (spec §4.3). Every temp file lives under the
 * extensions root and is removed on any outcome, so a failure at any step
 * leaves the previous install untouched and nothing partial behind.
 */
export async function installExtension(
  id: string,
  opts: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    fetchImpl?: typeof fetch
  } = {},
): Promise<Installed> {
  const entry = catalogEntry(id)
  if (entry === undefined) {
    throw invalidArguments(
      `${id} is not a known extension.`,
      `Try one of: ${CATALOG.map((e) => e.id).join(', ')}.`,
    )
  }
  await sweepDebris(extensionsRoot())
  const support = supportFor(entry)
  const asset = assetFor(entry)
  if (!support.supported || asset === undefined) {
    throw extensionUnsupported(id, support.reason ?? 'no build for this Mac')
  }
  const current = await installed(entry.id)
  if (current?.version === entry.version) return current

  const root = extensionsRoot()
  const base = join(root, entry.id)
  await mkdir(base, { recursive: true })

  try {
    const fs = await statfs(root)
    if (fs.bavail * fs.bsize < asset.bytes * 2.5) {
      throw extensionDiskFull(
        id,
        `not enough free disk space (about ${formatBytes(Math.ceil(asset.bytes * 2.5))} needed).`,
      )
    }
  } catch (e) {
    if (isForgeError(e)) throw e
  }

  const token = randomBytes(6).toString('hex')
  const archive = join(root, `.download-${token}.tar.gz`)
  const staging = join(base, `.staging-${token}`)
  try {
    const fetcher = opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await fetcher(assetUrl(asset.url), { signal: opts.signal })
    } catch {
      throw extensionDownloadFailed(id, `could not reach ${new URL(assetUrl(asset.url)).host}.`)
    }
    if (!res.ok || res.body === null) {
      throw extensionDownloadFailed(id, `the server answered ${res.status}.`)
    }

    const hash = createHash('sha256')
    let received = 0
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        if (received > asset.bytes) return cb(new TooLarge())
        hash.update(chunk)
        opts.onProgress?.(received, asset.bytes)
        cb(null, chunk)
      },
    })
    try {
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        tap,
        createWriteStream(archive),
        opts.signal ? { signal: opts.signal } : {},
      )
    } catch (cause) {
      if (opts.signal?.aborted) throw cause
      if (cause instanceof TooLarge) {
        throw extensionCorrupt(id, 'the download is larger than its published size.')
      }
      if (diskFull(cause)) throw extensionDiskFull(id, 'the disk filled up during the download.')
      throw extensionDownloadFailed(id, 'the connection dropped before the download finished.')
    }
    if (received < asset.bytes) {
      throw extensionDownloadFailed(id, 'the download ended early.')
    }
    if (hash.digest('hex') !== asset.sha256) {
      throw extensionCorrupt(id, 'the download does not match its published checksum.')
    }
    // A stop asked for while "checking" is honoured up to the swap: nothing
    // is in place yet, and the finally below clears what was unpacked.
    opts.signal?.throwIfAborted()

    try {
      await mkdir(staging, { recursive: true })
      await extractTar(await gunzipAsync(await readFile(archive)), staging)
      await verifyStaged(staging, entry)
    } catch (cause) {
      if (diskFull(cause)) throw extensionDiskFull(id, 'the disk filled up while unpacking.')
      throw extensionCorrupt(
        id,
        cause instanceof Error ? cause.message : 'the archive could not be unpacked.',
      )
    }

    opts.signal?.throwIfAborted()
    const target = join(base, entry.version)
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
    await writeCurrent(base, entry.version)

    // Old versions go only after the new one is in place.
    for (const name of await readdir(base)) {
      if (name !== entry.version && name !== 'current' && SAFE_NAME.test(name)) {
        await rm(join(base, name), { recursive: true, force: true })
      }
    }
    const result = await installed(entry.id)
    if (result === undefined) throw extensionCorrupt(id, 'the installed files could not be read.')
    return result
  } finally {
    await rm(archive, { force: true })
    await rm(staging, { recursive: true, force: true })
    // Only succeeds when nothing is installed there: a failed first install leaves no directory.
    await rmdir(base).catch(() => {})
  }
}

/**
 * True if something was removed. Refuses with `extension-in-use` while a job
 * (in any forge) holds the tool's lock, and holds it itself while deleting,
 * so no job can start on a half-deleted model.
 */
export async function removeExtension(id: string): Promise<boolean> {
  const entry = catalogEntry(id)
  if (entry === undefined) {
    throw invalidArguments(
      `${id} is not a known extension.`,
      `Try one of: ${CATALOG.map((e) => e.id).join(', ')}.`,
    )
  }
  return withExtensionLock(
    entry.id,
    async () => {
      await sweepDebris(extensionsRoot())
      const base = join(extensionsRoot(), entry.id)
      // Leftover temp files from an interrupted install are not an installed extension.
      const existed = (await readdir(base).catch(() => [] as string[])).some(
        (n) => !n.startsWith('.'),
      )
      await rm(base, { recursive: true, force: true })
      return existed
    },
    { waitMs: 0, action: 'remove', what: `${entry.title} is being removed` },
  )
}

export type { ExtensionId }
