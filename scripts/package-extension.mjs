#!/usr/bin/env node
/**
 * Packages an extension payload directory into a deterministic tar.gz.
 *
 *   node scripts/package-extension.mjs <id> <version> <arch|universal> <payloadDir> <outDir>
 *
 * Writes manifest.json into the archive (id, version, arch, per-file sha256,
 * entry, kind), then `forge-ext-<id>-<version>-<arch>.tar.gz` into outDir.
 * Prints one JSON line: {asset, bytes, sha256}.
 *
 * Deterministic: entries sorted bytewise, mtime/uid/gid/names zeroed, mode
 * normalised to 0644 / 0755 (exec bit kept), gzip header mtime 0 and OS
 * byte pinned, so the bytes do not depend on the host. Node
 * built-ins only; the output is plain ustar, readable by any `tar`.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const ENTRIES = {
  boost: { entry: 'runner.mjs', kind: 'node' },
  'remove-background': { entry: 'forge-cutout', kind: 'exec' },
  heic: { entry: 'runner.mjs', kind: 'node' },
  // ffmpeg beside ffprobe; Forge finds both in the extension's folder.
  video: { entry: 'ffmpeg', kind: 'exec' },
}
// Bare labels are the Mac builds, as published before Windows; win32 and linux ones say so.
const ARCHES = [
  'arm64',
  'x64',
  'universal',
  'win32-x64',
  'win32-arm64',
  'win32-universal',
  'linux-x64',
  'linux-arm64',
  'linux-universal',
]
const FIXED_MTIME = 946684800 // 2000-01-01
const GZIP_OS = 19 // macOS, as zlib on the macOS runners writes it

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function walk(root, rel = '') {
  const out = []
  for (const name of await readdir(join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name
    const s = await stat(join(root, r))
    if (s.isDirectory()) out.push(...(await walk(root, r)))
    else if (s.isFile()) out.push({ rel: r, exec: (s.mode & 0o111) !== 0 })
    else throw new Error(`unsupported file type: ${r}`)
  }
  return out
}

function octal(n, width) {
  return `${n.toString(8).padStart(width - 1, '0')}\0`
}

function header(name, size, exec) {
  const nameBuf = Buffer.from(name)
  let prefix = ''
  let base = name
  if (nameBuf.length > 100) {
    const i = name.lastIndexOf('/', name.length - 1)
    const cut = name.slice(0, i)
    base = name.slice(i + 1)
    prefix = cut
    if (i < 0 || Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155)
      throw new Error(`path too long for ustar: ${name}`)
  }
  const h = Buffer.alloc(512)
  h.write(base, 0, 'utf8')
  h.write(octal(exec ? 0o755 : 0o644, 8), 100, 'ascii')
  h.write(octal(0, 8), 108, 'ascii')
  h.write(octal(0, 8), 116, 'ascii')
  h.write(octal(size, 12), 124, 'ascii')
  h.write(octal(FIXED_MTIME, 12), 136, 'ascii')
  h.write('        ', 148, 'ascii') // checksum placeholder
  h.write('0', 156, 'ascii')
  h.write('ustar\0', 257, 'ascii')
  h.write('00', 263, 'ascii')
  h.write(prefix, 345, 'utf8')
  let sum = 0
  for (const b of h) sum += b
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return h
}

export async function packageExtension(id, version, arch, payloadDir, outDir) {
  const spec = ENTRIES[id]
  if (!spec) throw new Error(`unknown extension id: ${id}`)
  if (!ARCHES.includes(arch)) throw new Error(`arch must be one of ${ARCHES.join('|')}`)

  const found = (await walk(payloadDir)).filter((f) => f.rel !== 'manifest.json')
  found.sort((a, b) => Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel)))
  if (!found.some((f) => f.rel === spec.entry))
    throw new Error(`payload is missing entry ${spec.entry}`)

  const contents = new Map()
  const files = {}
  for (const f of found) {
    const buf = await readFile(join(payloadDir, f.rel))
    contents.set(f.rel, buf)
    files[f.rel] = sha256(buf)
  }
  const manifest = Buffer.from(
    `${JSON.stringify({ id, version, arch, files, entry: spec.entry, kind: spec.kind }, null, 2)}\n`,
  )

  const all = [
    { rel: 'manifest.json', exec: false, buf: manifest },
    ...found.map((f) => ({ ...f, buf: contents.get(f.rel) })),
  ]
  all.sort((a, b) => Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel)))

  const parts = []
  for (const e of all) {
    parts.push(header(e.rel, e.buf.length, e.exec), e.buf)
    const pad = (512 - (e.buf.length % 512)) % 512
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(1024))
  const gz = gzipSync(Buffer.concat(parts), { level: 9 })
  // The gzip header's OS byte is the one thing zlib takes from the host: 19
  // on macOS, 3 on Linux. Pinned to the macOS value every archive so far was
  // published with, so the same payload packs to the same bytes anywhere.
  gz[9] = GZIP_OS

  const asset = `forge-ext-${id}-${version}-${arch}.tar.gz`
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, asset), gz)
  return { asset, bytes: gz.length, sha256: sha256(gz) }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id, version, arch, payloadDir, outDir] = process.argv.slice(2)
  if (!outDir) {
    console.error(
      'usage: package-extension.mjs <id> <version> <arch|universal> <payloadDir> <outDir>',
    )
    process.exit(2)
  }
  try {
    console.log(JSON.stringify(await packageExtension(id, version, arch, payloadDir, outDir)))
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
