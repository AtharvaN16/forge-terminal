#!/usr/bin/env node
/**
 * Builds the published package: one esbuild ESM bundle (spec §4.5).
 *
 * - The externals are exactly package.json `dependencies`, today sharp and
 *   @hyzyla/pdfium, which carry a native binary or a wasm file and must be
 *   installed, not inlined. Everything else is bundled, so its maps, type
 *   declarations and duplicate builds never reach a user's disk.
 * - `splitting` keeps every dynamic import (engines' libraries, execute.ts,
 *   the shell) as its own chunk, so bundling does not undo lazy loading.
 * - No source maps. `--debug` stack traces point at bundle lines.
 * - The `require` banner gives bundled CommonJS a real `require` for Node
 *   built-ins under ESM.
 * - The licences of everything inlined go into third-party-licenses.txt,
 *   since their own LICENSE files no longer ship.
 *
 *   node scripts/build.mjs [--outdir dist] [--metafile]
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    outdir: { type: 'string', default: 'dist' },
    metafile: { type: 'boolean', default: false },
  },
})
/**
 * ink/build/devtools.js (pulled in by a dynamic import that runs only when
 * react-devtools-core is installed, which it never is here) drags in `ws`
 * and its optional native addons. Nothing is gained by shipping it.
 */
const dropInkDevtools = {
  name: 'drop-ink-devtools',
  setup(b) {
    b.onResolve({ filter: /^\.\/devtools\.js$/ }, (args) =>
      args.importer.includes('/node_modules/ink/')
        ? { path: join(ROOT, 'scripts/stubs/react-devtools-core.mjs') }
        : undefined,
    )
  },
}
const outdir = resolve(ROOT, values.outdir)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

rmSync(outdir, { recursive: true, force: true })

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: ['src/index.ts'],
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // ES builds first: a dynamic import() of a CommonJS package resolves to
  // { default } only, so named imports (pdf-lib's PDFDocument) need the ESM
  // build to arrive as named exports, as they do from node_modules.
  mainFields: ['module', 'main'],
  external: Object.keys(pkg.dependencies ?? {}),
  alias: { 'react-devtools-core': './scripts/stubs/react-devtools-core.mjs' },
  plugins: [dropInkDevtools],
  banner: {
    js: "import { createRequire as __forgeCreateRequire } from 'node:module';\nconst require = __forgeCreateRequire(import.meta.url);",
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  logLevel: 'warning',
})

writeFileSync(join(outdir, 'third-party-licenses.txt'), licences(result.metafile))
if (values.metafile) writeFileSync(join(outdir, 'meta.json'), JSON.stringify(result.metafile))

/** One section per package the bundle inlines: name, version, licence, and its licence text. */
function licences(metafile) {
  const packages = new Map()
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf('node_modules/')
    if (at === -1) continue
    const [first, second] = input.slice(at + 'node_modules/'.length).split('/')
    const name = first.startsWith('@') ? `${first}/${second}` : first
    packages.set(join(ROOT, input.slice(0, at), 'node_modules', name), name)
  }
  const sections = [...packages]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([dir, name]) => {
      const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const licence =
        typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'UNKNOWN')
      const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f))
      const text =
        file === undefined
          ? `(no licence file in the package; package.json says ${licence})`
          : readFileSync(join(dir, file), 'utf8').trim()
      return `${name}@${meta.version} — ${licence}\n\n${text}`
    })
  return `Forge bundles the following packages.\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`
}
