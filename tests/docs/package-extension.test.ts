import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from '../helpers/fixtures.js'

const script = join(process.cwd(), 'scripts/package-extension.mjs')
const run = (out: string, payload: string, arch = 'universal') =>
  JSON.parse(
    execFileSync('node', [script, 'remove-background', '1.2.3', arch, payload, out], {
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
  it('packs a Windows or Linux remove-background as the Node runner, and names the OS', async () => {
    const root = await makeTempDir()
    const payload = join(root, 'payload')
    await mkdir(payload, { recursive: true })
    await writeFile(join(payload, 'runner.mjs'), 'export {}\n')
    await writeFile(join(payload, 'u2netp.onnx'), 'model')
    for (const arch of ['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']) {
      const r = run(join(root, arch), payload, arch)
      expect(r.asset).toBe(`forge-ext-remove-background-1.2.3-${arch}.tar.gz`)
      const x = join(root, `x-${arch}`)
      await mkdir(x)
      execFileSync('tar', ['-xzf', join(root, arch, r.asset), '-C', x])
      const manifest = JSON.parse(await readFile(join(x, 'manifest.json'), 'utf8'))
      expect(manifest).toMatchObject({ arch, entry: 'runner.mjs', kind: 'node' })
    }
    // A Mac label is still Apple Vision's helper, and needs it.
    expect(() => run(join(root, 'mac'), payload, 'universal')).toThrow()
  })

  it('writes the same gzip header on every host: the OS byte macOS wrote', async () => {
    const root = await makeTempDir()
    const payload = join(root, 'payload')
    await mkdir(payload, { recursive: true })
    await writeFile(join(payload, 'runner.mjs'), 'export {}\n')
    const r = run(join(root, 'out'), payload, 'linux-x64')
    const gz = await readFile(join(root, 'out', r.asset))
    // ID1 ID2 CM FLG, MTIME 0, XFL 2 (level 9), OS 19.
    expect([...gz.subarray(0, 10)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 2, 19])
  })
})
