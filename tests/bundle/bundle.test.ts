import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import * as nodeModule from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractPdfText } from '../../src/engines/pdfium.js'
import { VERSION } from '../../src/shell/theme.js'
import {
  makeDoc,
  makeDocx,
  makeJpeg,
  makePdf,
  makeScannedPdf,
  makeTempDir,
  makeTextPdf,
} from '../helpers/fixtures.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

/**
 * Spec §4.5: one suite runs against the built bundle, so a bundling mistake
 * (a missed external, a broken dynamic import, a chunk that cannot load)
 * fails here rather than for a user. Built into .bundle-test/ inside the
 * repo, so the externals resolve from the repo's node_modules the way they
 * will from the installed package's. Every command runs from an unrelated
 * cwd (Review Focus 4).
 */
const run = promisify(execFile)
const root = process.cwd()
const outdir = join(root, '.bundle-test')
const bin = join(outdir, 'index.js')

interface Meta {
  outputs: Record<
    string,
    { entryPoint?: string; imports: Array<{ path: string; kind: string; external?: boolean }> }
  >
}
let meta: Meta
let elsewhere: string

beforeAll(async () => {
  await run(
    process.execPath,
    [join(root, 'scripts', 'build.mjs'), '--outdir', '.bundle-test', '--metafile'],
    {
      cwd: root,
    },
  )
  meta = JSON.parse(await readFile(join(outdir, 'meta.json'), 'utf8')) as Meta
  elsewhere = await mkdtemp(join(tmpdir(), 'forge-elsewhere-'))
}, 120_000)

async function forge(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], {
      cwd: elsewhere,
      env: { ...process.env, ...env },
    })
    return { exitCode: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { exitCode: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

/** The bundle's output file for a source module that was split into its own chunk. */
function chunkFor(entryPoint: string): string {
  const found = Object.entries(meta.outputs).find(([, o]) => o.entryPoint === entryPoint)
  if (!found) throw new Error(`no chunk for ${entryPoint}`)
  return found[0]
}

const packageOf = (specifier: string) => {
  const [first = '', second = ''] = specifier.split('/')
  return first.startsWith('@') ? `${first}/${second}` : first
}

describe('the bundle', { timeout: 30_000 }, () => {
  it('reaches outside itself only for Node built-ins and its declared dependencies', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const builtins = new Set(nodeModule.builtinModules)
    const externals = new Set<string>()
    for (const output of Object.values(meta.outputs)) {
      for (const imp of output.imports) {
        if (!imp.external || imp.path.startsWith('node:')) continue
        if (builtins.has(imp.path) || builtins.has(packageOf(imp.path))) continue
        externals.add(packageOf(imp.path))
      }
    }
    expect([...externals].sort()).toEqual(Object.keys(pkg.dependencies).sort())
  })

  it('ships no source maps', async () => {
    const files = (await readdir(outdir, { recursive: true })) as string[]
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([])
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      expect(await readFile(join(outdir, file), 'utf8'), file).not.toContain('sourceMappingURL')
    }
  })

  it('ships the licences of what it inlines', async () => {
    const text = await readFile(join(outdir, 'third-party-licenses.txt'), 'utf8')
    expect(text).toContain('ink@')
    expect(text).toContain('pdf-lib@')
    expect(text).not.toContain('sharp@')
  })

  it('answers --version with nothing on stderr', async () => {
    const result = await forge(['--version'])
    expect(result).toEqual({ exitCode: 0, stdout: `${VERSION}\n`, stderr: '' })
  })

  it('answers --version without loading an external or the execute or shell chunks', async () => {
    const { exitCode, urls } = await modulesLoaded([bin, '--version'], {
      tsx: false,
      cwd: elsewhere,
    })
    expect(exitCode).toBe(0)
    const packages = packagesIn(urls)
    expect(packages).not.toContain('sharp')
    expect(packages).not.toContain('@hyzyla/pdfium')
    for (const entry of ['src/cli/execute.ts', 'src/shell/boot.ts', 'src/shell/launch.tsx']) {
      expect(
        urls.some((u) => u.endsWith(chunkFor(entry))),
        entry,
      ).toBe(false)
    }
  })

  it('fills Node’s compile cache when Node has one', async (ctx) => {
    if (typeof nodeModule.enableCompileCache !== 'function') {
      ctx.skip('this Node has no compile cache')
      return
    }
    const cache = await mkdtemp(join(tmpdir(), 'forge-cache-'))
    await forge(['--formats'], { NODE_COMPILE_CACHE: cache })
    expect((await readdir(cache, { recursive: true })).length).toBeGreaterThan(0)
  })

  it('converts a JPEG to WebP', async () => {
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'a.jpg')
    const result = await forge([jpeg, '--to', 'webp'])
    expect(result.exitCode).toBe(0)
    expect(await readdir(dir)).toContain('a.webp')
  })

  it('rasterises a PDF to PNG through pdfium', async () => {
    const dir = await makeTempDir()
    const pdf = await makeTextPdf(dir, 'doc.pdf', ['Rendered.'])
    const result = await forge([pdf, '--to', 'png'])
    expect(result.exitCode).toBe(0)
    expect(await readdir(dir)).toContain('doc-1.png')
  })

  it('converts a PDF to DOCX, text intact, nothing on stderr', async () => {
    const dir = await makeTempDir()
    const pdf = await makeTextPdf(dir, 'notes.pdf', ['Hello from the bundle.'])
    const result = await forge([pdf, '--to', 'docx'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const { value } = await mammoth.extractRawText({ path: join(dir, 'notes.docx') })
    expect(value).toContain('Hello from the bundle.')
  })

  it('converts a DOCX to PDF through mammoth', async () => {
    const dir = await makeTempDir()
    const docx = await makeDocx(dir, 'letter.docx', ['Dear reader.'])
    const result = await forge([docx, '--to', 'pdf'])
    expect(result.exitCode).toBe(0)
    const pages = await extractPdfText(await readFile(join(dir, 'letter.pdf')))
    expect(pages.join('\n')).toContain('Dear reader.')
  })

  it('converts a legacy DOC to PDF through word-extractor', async (ctx) => {
    const dir = await makeTempDir()
    const doc = await makeDoc(dir, 'old.doc', 'Legacy words.')
    if (doc === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const result = await forge([doc, '--to', 'pdf'])
    expect(result.exitCode).toBe(0)
    const pages = await extractPdfText(await readFile(join(dir, 'old.pdf')))
    expect(pages.join('\n')).toContain('Legacy words.')
  })

  it('rotates PDF pages through pdf-lib', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'p.pdf', 2)
    const result = await forge([pdf, '--rotate', '90'])
    expect(result.exitCode).toBe(0)
    const out = await PDFDocument.load(await readFile(join(dir, 'p-rotated.pdf')))
    expect(out.getPageCount()).toBe(2)
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90])
  })

  it('compresses a PDF to a size through the pdf-compress chunk', async () => {
    const dir = await makeTempDir()
    const pdf = await makeScannedPdf(dir, 's.pdf', { pages: 2 })
    const before = (await stat(pdf)).size
    const limit = 150_000
    expect(before).toBeGreaterThan(limit)
    const result = await forge([pdf, '--max-size', '150kb'])
    expect(result.exitCode).toBe(0)
    const outPath = join(dir, 's-small.pdf')
    expect((await stat(outPath)).size).toBeLessThanOrEqual(150 * 1024)
    expect((await PDFDocument.load(await readFile(outPath))).getPageCount()).toBe(2)
  })

  it('loads the shell chunk: Ink, React and yoga', async () => {
    const launch = join(root, chunkFor('src/shell/launch.tsx'))
    const { stdout } = await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const m = await import(process.argv[1]); console.log(typeof m.launchShell)',
        launch,
      ],
      { cwd: elsewhere, env: { ...process.env, FORCE_COLOR: '0' } },
    )
    expect(stdout.trim()).toBe('function')
  })

  it('resolves sharp from the package, not from the caller’s cwd', async () => {
    const decoy = await mkdtemp(join(tmpdir(), 'forge-decoy-'))
    await mkdir(join(decoy, 'node_modules', 'sharp'), { recursive: true })
    await writeFile(
      join(decoy, 'node_modules', 'sharp', 'package.json'),
      '{"name":"sharp","main":"index.js"}',
    )
    await writeFile(
      join(decoy, 'node_modules', 'sharp', 'index.js'),
      'throw new Error("decoy sharp loaded")',
    )
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'd.jpg')
    const { stdout, stderr } = await run(process.execPath, [bin, jpeg, '--to', 'webp'], {
      cwd: decoy,
    })
    expect(stdout + stderr).not.toContain('decoy')
    expect(await readdir(dir)).toContain('d.webp')
  })

  it('refuses to open the shell without a terminal, from the bundle too', async () => {
    const result = await forge([])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Forge needs a file and a target format.')
  })
})
