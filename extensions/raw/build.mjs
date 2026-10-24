#!/usr/bin/env node
/**
 * Builds the raw payload directory.
 *
 *   node extensions/raw/build.mjs --out <dir>
 *
 * <dir> receives:
 *   runner.mjs    runner.ts and crop.ts bundled — Forge's own code only
 *   libraw.mjs    libraw-wasm's Emscripten glue (dist/libraw.js), unmodified
 *   libraw.wasm   LibRaw, Little CMS, libjpeg, libpng and zlib compiled to WASM, unmodified
 *   NOTICES.txt   licence texts for libraw-wasm (ISC) and LibRaw (LGPL-2.1 or CDDL-1.0)
 *
 * The LGPL library stays in its own two files, loaded by runner.mjs at run
 * time, so a user can replace it with their own build — not inlined in the
 * bundle. WASM is chip-independent, so the payload is the same everywhere.
 *
 * No network: the library comes from node_modules, and the licence texts it
 * does not ship from extensions/raw/licences. manifest.json is not written
 * here — scripts/package-extension.mjs does that.
 */

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') out.out = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!out.out) throw new Error('--out <dir> is required')
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const out = resolve(args.out)
  mkdirSync(out, { recursive: true })

  await build({
    entryPoints: [join(here, 'runner.ts')],
    outfile: join(out, 'runner.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none',
    logLevel: 'warning',
  })

  // The library ships as files beside the runner, never bundled (LGPL). The
  // glue is an ES module, hence .mjs: there is no package.json in the payload.
  const pkgDir = dirname(require.resolve('libraw-wasm/package.json'))
  copyFileSync(join(pkgDir, 'dist', 'libraw.js'), join(out, 'libraw.mjs'))
  copyFileSync(join(pkgDir, 'dist', 'libraw.wasm'), join(out, 'libraw.wasm'))
  // npm ships the .wasm executable; it is data, and the archive should not say otherwise.
  chmodSync(join(out, 'libraw.wasm'), 0o644)
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const licence = (name) => readFileSync(join(here, 'licences', name), 'utf8')
  writeFileSync(
    join(out, 'NOTICES.txt'),
    notices(pkg.version, {
      wasm: licence('libraw-wasm-LICENSE'),
      copyright: licence('LibRaw-COPYRIGHT'),
      lgpl: licence('LibRaw-LICENSE.LGPL'),
      cddl: licence('LibRaw-LICENSE.CDDL'),
      lcms: licence('lcms2-LICENSE'),
    }),
  )
  console.log(out)
}

const RULE = '-'.repeat(76)

/**
 * LGPL compliance: the licence texts, and where the source is. libraw-wasm
 * 1.6.0 builds LibRaw 0.22.1 and Little CMS 2.19.1 from their own tags
 * (its compileLibraw.sh) and links Emscripten's libjpeg, libpng and zlib.
 * It declares ISC in package.json but ships no licence file, so its text is
 * kept in extensions/raw/licences, as are LibRaw's and Little CMS's, which
 * the npm package does not carry either.
 */
function notices(version, t) {
  return `Forge "RAW" extension — third-party notices

libraw.mjs and libraw.wasm are libraw-wasm ${version}, an Emscripten (WASM)
build of LibRaw 0.22.1, unmodified. LibRaw is the LGPL library: runner.mjs
(Forge's own code) loads these two files from this directory at run time, so
they can be replaced with another build of the same libraw-wasm version.

LibRaw is licensed under either the GNU Lesser General Public License,
version 2.1, or the Common Development and Distribution License, version 1.0,
at your choice; both texts are below. libraw-wasm's own code is ISC.

Source: https://github.com/ybouane/LibRaw-Wasm (tag v${version})
LibRaw: https://github.com/LibRaw/LibRaw (tag 0.22.1)
Little CMS: https://github.com/mm2/Little-CMS (tag lcms2.19.1)

The same WASM also contains, linked by Emscripten:
  Little CMS 2.19.1 (MIT, text below)
  libjpeg — this software is based in part on the work of the Independent JPEG Group
  libpng (libpng licence) and zlib (zlib licence)

${RULE}
libraw-wasm
${RULE}

${t.wasm}
${RULE}
LibRaw — copyright
${RULE}

${t.copyright}
${RULE}
LibRaw — GNU Lesser General Public License, version 2.1
${RULE}

${t.lgpl}
${RULE}
LibRaw — Common Development and Distribution License, version 1.0
${RULE}

${t.cddl}
${RULE}
Little CMS
${RULE}

${t.lcms}`
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
