import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'

/**
 * A minimal tar reader: regular files and directories only. Written here
 * rather than shelling out to `tar` so that path safety is ours — an archive
 * entry that is absolute, climbs out with `..`, or is a link is refused, not
 * left to a system tool's defaults.
 */
const BLOCK = 512

function cstr(buf: Buffer, start: number, len: number): string {
  const end = buf.indexOf(0, start)
  return buf.toString('utf8', start, end === -1 || end > start + len ? start + len : end)
}

function octal(buf: Buffer, start: number, len: number): number {
  const n = Number.parseInt(cstr(buf, start, len).trim() || '0', 8)
  if (Number.isNaN(n)) throw new Error('bad tar header')
  return n
}

export async function extractTar(tar: Buffer, destDir: string): Promise<void> {
  let pos = 0
  let longName: string | undefined
  while (pos + BLOCK <= tar.length) {
    const header = tar.subarray(pos, pos + BLOCK)
    if (header.every((b) => b === 0)) return
    const size = octal(header, 124, 12)
    const mode = octal(header, 100, 8)
    const type = String.fromCharCode(header[156] ?? 0)
    const prefix = cstr(header, 345, 155)
    let name = prefix.length > 0 ? `${prefix}/${cstr(header, 0, 100)}` : cstr(header, 0, 100)
    pos += BLOCK
    const body = tar.subarray(pos, pos + size)
    if (body.length < size) throw new Error('truncated tar')
    pos += Math.ceil(size / BLOCK) * BLOCK

    if (type === 'L') {
      longName = cstr(body, 0, body.length)
      continue
    }
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))
      if (m?.[1] !== undefined) longName = m[1]
      continue
    }
    if (type === 'g') continue
    if (longName !== undefined) {
      name = longName
      longName = undefined
    }

    // Tar names are POSIX whatever the host, so normalise them as POSIX; a
    // backslash or drive letter would be a separator or a root on Windows.
    const rel = posix.normalize(name)
    if (
      rel.startsWith('/') ||
      rel === '..' ||
      rel.startsWith('../') ||
      rel.includes('\\') ||
      /^[A-Za-z]:/.test(rel)
    ) {
      throw new Error(`unsafe path in archive: ${name}`)
    }
    if (type === '5') {
      await mkdir(join(destDir, rel), { recursive: true })
    } else if (type === '0' || type === '\0') {
      const target = join(destDir, rel)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body, { mode: mode & 0o100 ? 0o755 : 0o644 })
    } else {
      throw new Error(`unsupported entry type in archive: ${name}`)
    }
  }
}
