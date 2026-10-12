import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTar } from '../../src/extensions/tar.js'

/** One ustar entry. `type` is the typeflag; `link` the linkname of a symlink or hardlink. */
function entry(name: string, body: Buffer, type = '0', link = ''): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write('0000644\0', 100)
  h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
  h.write(type, 156)
  h.write(link, 157, 100)
  h.write('ustar\0', 257)
  h.fill(' ', 148, 156)
  h.write(
    `${h
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, '0')}\0 `,
    148,
  )
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)])
}

const pax = (record: string) => {
  const line = (n: number) => `${n} ${record}\n`
  let n = line(0).length
  while (line(n).length !== n) n = line(n).length
  return entry('PaxHeader', Buffer.from(line(n)), 'x')
}

const tar = (...parts: Buffer[]) => Buffer.concat([...parts, Buffer.alloc(1024)])

/** Extracts into `<tmp>/dest`; `result` is the error message, or 'ok'. Nothing may appear in `<tmp>`. */
async function extract(archive: Buffer): Promise<{ result: string; tmp: string }> {
  const tmp = await mkdtemp(join(tmpdir(), 'forge-tar-'))
  const dest = join(tmp, 'dest')
  const result = await extractTar(archive, dest).then(
    () => 'ok',
    (e: Error) => e.message,
  )
  return { result, tmp }
}

describe('extractTar refuses', () => {
  it('an absolute path, writing nothing', async () => {
    const { result, tmp } = await extract(tar(entry('/tmp/forge-abs', Buffer.from('x'))))
    expect(result).toMatch(/unsafe path/)
    expect(await readdir(tmp)).toEqual([])
  })

  it('a symlink entry', async () => {
    const { result, tmp } = await extract(tar(entry('link', Buffer.alloc(0), '2', '/etc/passwd')))
    expect(result).toMatch(/unsupported entry type/)
    expect(await readdir(tmp)).toEqual([])
  })

  it('a hardlink entry', async () => {
    const { result, tmp } = await extract(tar(entry('link', Buffer.alloc(0), '1', '/etc/passwd')))
    expect(result).toMatch(/unsupported entry type/)
    expect(await readdir(tmp)).toEqual([])
  })

  it('a pax path= that climbs out with ..', async () => {
    const { result, tmp } = await extract(
      tar(pax('path=../escape'), entry('harmless', Buffer.from('x'))),
    )
    expect(result).toMatch(/unsafe path/)
    expect(await readdir(tmp)).toEqual([])
  })

  it('a backslash path, which climbs out on Windows', async () => {
    const { result, tmp } = await extract(tar(entry('..\\escape', Buffer.from('x'))))
    expect(result).toMatch(/unsafe path/)
    expect(await readdir(tmp)).toEqual([])
  })
})
