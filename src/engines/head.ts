import { open } from 'node:fs/promises'

/**
 * The first `n` bytes of a file, or fewer when it is shorter.
 *
 * Probing goes engine by engine until one recognises the file, and the
 * document engines would otherwise read the whole file to find out it is not
 * theirs. A large file nothing recognises (a disk image, a zip, a WMV) then
 * cost two full reads just to be refused; its first bytes say the same thing.
 */
export async function readHead(path: string, n: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const b = Buffer.alloc(n)
    const { bytesRead } = await handle.read(b, 0, n, 0)
    return b.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
