import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeTempDir } from './fixtures.js'

/**
 * Installs a stand-in for an extension, laid out exactly as the manager
 * leaves a real one (`<root>/<id>/current`, `<root>/<id>/<version>/manifest.json`)
 * and obeying the child-process contract. It points XDG_CONFIG_HOME at a
 * fresh temp dir and returns it; the previous value is restored by `restore`.
 *
 * The stand-in boost enlarges the PNG by `--scale` with plain resize, keeping
 * whatever channels it was given (so alpha Forge drops stays dropped); the
 * stand-in cutout makes the top-left pixel column transparent. Neither is
 * the real model, which is the point: Forge's side of the contract is what
 * is under test.
 */
const sharpUrl = pathToFileURL(createRequire(import.meta.url).resolve('sharp')).href

const BOOST = `
import sharp from '${sharpUrl}'
const a = process.argv.slice(2)
const get = (k) => a[a.indexOf(k) + 1]
const scale = Number(get('--scale'))
const img = sharp(get('--in'))
const { width, height } = await img.metadata()
await img.resize(width * scale, height * scale).png().toFile(get('--out'))
console.log(JSON.stringify({ ok: true, width: width * scale, height: height * scale, ms: 1 }))
`

const CUTOUT = `
import sharp from '${sharpUrl}'
const [input, out] = process.argv.slice(2)
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
for (let y = 0; y < info.height; y++) data[(y * info.width) * 4 + 3] = 0
await sharp(data, { raw: info }).png().toFile(out)
console.log(JSON.stringify({ ok: true, width: info.width, height: info.height, ms: 1 }))
`

export function fakeExtensions() {
  const saved = process.env.XDG_CONFIG_HOME
  return {
    async home(): Promise<string> {
      const home = await makeTempDir()
      process.env.XDG_CONFIG_HOME = home
      return home
    },
    async install(home: string, id: 'boost' | 'remove-background'): Promise<void> {
      const dir = join(home, 'forge', 'extensions', id)
      const version = join(dir, '1.0.0')
      await mkdir(version, { recursive: true })
      await writeFile(join(version, 'runner.mjs'), id === 'boost' ? BOOST : CUTOUT)
      await writeFile(
        join(version, 'manifest.json'),
        JSON.stringify({
          id,
          version: '1.0.0',
          arch: 'universal',
          files: { 'runner.mjs': 'unchecked' },
          entry: 'runner.mjs',
          kind: 'node',
        }),
      )
      await writeFile(join(dir, 'current'), '1.0.0\n')
    },
    restore(): void {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = saved
    },
  }
}
