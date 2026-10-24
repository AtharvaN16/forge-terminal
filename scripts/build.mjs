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
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
      /[\\/]node_modules[\\/]ink[\\/]/.test(args.importer)
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
buildTranscribeHelper()
copyWhisperTranscribeHelper()
copyPdfFonts()

/**
 * The transcribe helper (spec 2026-10-17-transcribe-design §4.1): Swift,
 * macOS 26 and later, universal — Apple silicon and Intel (spec
 * 2026-10-23-extract-text-design §5.5; the Intel slice is untested). Built
 * where swiftc and a macOS 26 SDK are; skipped with one line everywhere else
 * (Windows, Linux, the macos-14 test runners), where transcribe runs on the
 * whisper helper instead. The publish job sets FORGE_REQUIRE_HELPERS=1 so a
 * release cannot ship without it.
 */
function buildTranscribeHelper() {
  const required = process.env.FORGE_REQUIRE_HELPERS === '1'
  if (process.platform !== 'darwin') {
    if (required)
      throw new Error('FORGE_REQUIRE_HELPERS: the transcribe helper builds only on macOS')
    return
  }
  const out = join(outdir, 'helpers', 'forge-transcribe')
  mkdirSync(join(outdir, 'helpers'), { recursive: true })
  const slice = (arch) => {
    const path = `${out}-${arch}`
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-O',
        '-parse-as-library',
        '-target',
        `${arch}-apple-macos26.0`,
        join(ROOT, 'helpers/transcribe/forge-transcribe.swift'),
        '-o',
        path,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    return path
  }
  try {
    const slices = [slice('arm64'), slice('x86_64')]
    execFileSync('xcrun', ['lipo', '-create', ...slices, '-output', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    for (const path of slices) rmSync(path, { force: true })
  } catch (e) {
    if (required) throw e
    console.log('transcribe helper skipped: needs swiftc and a macOS 26 SDK')
  }
}

/**
 * The whisper transcribe helper (Windows, Linux, and Macs without Apple's
 * recogniser): plain Node (whisper.cpp + ffmpeg underneath), so it is copied,
 * not built, and copied on every OS: releases are cut on macOS.
 */
function copyWhisperTranscribeHelper() {
  mkdirSync(join(outdir, 'helpers'), { recursive: true })
  copyFileSync(
    join(ROOT, 'helpers/transcribe/forge-transcribe-whisper.mjs'),
    join(outdir, 'helpers', 'forge-transcribe-whisper.mjs'),
  )
}

/**
 * The fonts a transcript PDF is set in (src/engines/pages-pdf.ts), Noto Sans
 * under the SIL Open Font License: copied beside the bundle, with the licence
 * text added to third-party-licenses.txt, since the OFL asks that it travels
 * with the font.
 */
function copyPdfFonts() {
  const from = join(ROOT, 'assets/fonts')
  const to = join(outdir, 'fonts')
  mkdirSync(to, { recursive: true })
  for (const file of readdirSync(from).filter((f) => f.endsWith('.ttf.gz') || f === 'OFL.txt'))
    copyFileSync(join(from, file), join(to, file))
  appendFileSync(
    join(outdir, 'third-party-licenses.txt'),
    `\n${'-'.repeat(72)}\n\nNoto Sans (fonts/NotoSans-*.ttf.gz) — OFL-1.1\n\n${readFileSync(join(from, 'OFL.txt'), 'utf8').trim()}\n`,
  )
}

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
