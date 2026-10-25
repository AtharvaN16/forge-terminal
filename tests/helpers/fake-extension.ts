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
 * whatever channels it was given (so alpha Forge drops stays dropped). It
 * takes `--serve` too, as boost 1.4.0 and later do (one job a stdin line),
 * and with FAKE_BOOST_LOG set appends a line per process it is started as,
 * `serve <pid>` or `one <pid>`, so a test can tell which Forge used; the
 * stand-in cutout makes the top-left pixel column transparent. Neither is
 * the real model, which is the point: Forge's side of the contract is what
 * is under test.
 */
const sharpUrl = pathToFileURL(createRequire(import.meta.url).resolve('sharp')).href

const BOOST = `
import { appendFileSync } from 'node:fs'
import sharp from '${sharpUrl}'
async function boost(a) {
  const get = (k) => a[a.indexOf(k) + 1]
  const scale = Number(get('--scale'))
  const img = sharp(get('--in'))
  const { width, height } = await img.metadata()
  await img.resize(width * scale, height * scale).png().toFile(get('--out'))
  return JSON.stringify({ ok: true, width: width * scale, height: height * scale, ms: 1 })
}
const argv = process.argv.slice(2)
const serving = argv[0] === '--serve'
if (process.env.FAKE_BOOST_LOG)
  appendFileSync(process.env.FAKE_BOOST_LOG, (serving ? 'serve ' : 'one ') + process.pid + '\\n')
if (serving) {
  let pending = ''
  let queue = Promise.resolve()
  process.stdin.on('end', () => process.exit(0))
  process.stdin.setEncoding('utf8').on('data', (d) => {
    const lines = (pending + d).split('\\n')
    pending = lines.pop()
    for (const line of lines)
      queue = queue.then(async () => console.log(await boost(JSON.parse(line).args)))
  })
} else console.log(await boost(argv))
`

const CUTOUT = `
import sharp from '${sharpUrl}'
const [input, out] = process.argv.slice(2)
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
for (let y = 0; y < info.height; y++) data[(y * info.width) * 4 + 3] = 0
await sharp(data, { raw: info }).png().toFile(out)
console.log(JSON.stringify({ ok: true, width: info.width, height: info.height, ms: 1 }))
`

/**
 * The stand-in read-text: one page event and one text block per --in, saying
 * which page it was given and the PNG's width, plus a word broken as PP-OCR
 * breaks one at a ligature, for the text-layer mend to fix.
 */
const READ_TEXT = `
import sharp from '${sharpUrl}'
const a = process.argv.slice(2)
const ins = a.flatMap((v, i) => (v === '--in' ? [a[i + 1]] : []))
const pages = []
for (const [i, path] of ins.entries()) {
  console.log(JSON.stringify({ event: 'page', page: i + 1, of: ins.length }))
  const { width } = await sharp(path).metadata()
  pages.push({ blocks: [{ kind: 'text', text: 'page ' + (i + 1) + ' width ' + width + ' waff e', title: false, lines: 1, lineHeight: 0.02, box: [0.1, 0.1, 0.8, 0.02] }] })
}
console.log(JSON.stringify({ ok: true, pages }))
`

export function fakeExtensions() {
  const saved = process.env.XDG_CONFIG_HOME
  return {
    async home(): Promise<string> {
      const home = await makeTempDir()
      process.env.XDG_CONFIG_HOME = home
      return home
    },
    async install(
      home: string,
      id: 'boost' | 'remove-background' | 'read-text',
      version = '1.0.0',
    ): Promise<void> {
      const dir = join(home, 'forge', 'extensions', id)
      const payload = join(dir, version)
      await mkdir(payload, { recursive: true })
      await writeFile(
        join(payload, 'runner.mjs'),
        id === 'boost' ? BOOST : id === 'read-text' ? READ_TEXT : CUTOUT,
      )
      await writeFile(
        join(payload, 'manifest.json'),
        JSON.stringify({
          id,
          version,
          arch: 'universal',
          files: { 'runner.mjs': 'unchecked' },
          entry: 'runner.mjs',
          kind: 'node',
        }),
      )
      await writeFile(join(dir, 'current'), `${version}\n`)
    },
    restore(): void {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = saved
    },
  }
}
