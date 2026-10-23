import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from '../helpers/fixtures.js'

const script = join(process.cwd(), 'scripts/package-extension.mjs')
const run = (out: string, payload: string) =>
  JSON.parse(
    execFileSync('node', [script, 'remove-background', '1.2.3', 'universal', payload, out], {
      encoding: 'utf8',
    }),
  ) as { asset: string; bytes: number; sha256: string }

describe('package-extension', () => {
  // Packaging runs on the macOS CI runner; Windows has no exec bit to keep.
  it.skipIf(process.platform === 'win32')(
    'is deterministic, writes a verifying manifest, keeps the exec bit',
    async () => {
      const root = await makeTempDir()
      const payload = join(root, 'payload')
      await mkdir(join(payload, 'sub'), { recursive: true })
      await writeFile(join(payload, 'forge-cutout'), '#!/bin/sh\necho hi\n')
      await chmod(join(payload, 'forge-cutout'), 0o755)
      await writeFile(join(payload, 'NOTICES.txt'), 'notices')
      await writeFile(join(payload, 'sub', 'data.bin'), Buffer.alloc(700, 7))

      const a = run(join(root, 'a'), payload)
      await new Promise((r) => setTimeout(r, 1100))
      const b = run(join(root, 'b'), payload)
      const fa = await readFile(join(root, 'a', a.asset))
      const fb = await readFile(join(root, 'b', b.asset))
      expect(fa.equals(fb)).toBe(true)
      expect(a.sha256).toBe(createHash('sha256').update(fa).digest('hex'))
      expect(a.bytes).toBe(fa.length)

      const x = join(root, 'x')
      await mkdir(x)
      const archive = join(root, 'a', a.asset)
      const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' })
      expect(listing).toMatch(/^-rwxr-xr-x.*forge-cutout$/m)
      expect(listing).toMatch(/^-rw-r--r--.*NOTICES\.txt$/m)
      execFileSync('tar', ['-xzf', archive, '-C', x])

      const manifest = JSON.parse(await readFile(join(x, 'manifest.json'), 'utf8'))
      expect(manifest).toMatchObject({
        id: 'remove-background',
        version: '1.2.3',
        arch: 'universal',
        entry: 'forge-cutout',
        kind: 'exec',
      })
      expect(Object.keys(manifest.files)).toEqual(['NOTICES.txt', 'forge-cutout', 'sub/data.bin'])
      for (const [rel, hash] of Object.entries(manifest.files)) {
        const got = createHash('sha256')
          .update(await readFile(join(x, rel)))
          .digest('hex')
        expect(got).toBe(hash)
      }
    },
  )

  it('packs linux archives, and pins the gzip OS byte so the host leaves no trace', async () => {
    const root = await makeTempDir()
    const payload = join(root, 'payload')
    await mkdir(payload, { recursive: true })
    await writeFile(join(payload, 'runner.mjs'), 'console.log(1)\n')
    const out = join(root, 'out')
    const r = JSON.parse(
      execFileSync('node', [script, 'heic', '1.0.0', 'linux-universal', payload, out], {
        encoding: 'utf8',
      }),
    ) as { asset: string }
    expect(r.asset).toBe('forge-ext-heic-1.0.0-linux-universal.tar.gz')
    const gz = await readFile(join(out, r.asset))
    // 19 is what macOS's zlib writes, and what every published archive carries.
    expect(gz[9]).toBe(19)
    const x = join(root, 'x')
    await mkdir(x)
    execFileSync('tar', ['-xzf', join(out, r.asset), '-C', x])
    const manifest = JSON.parse(await readFile(join(x, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'heic', arch: 'linux-universal', entry: 'runner.mjs' })
  })
})
