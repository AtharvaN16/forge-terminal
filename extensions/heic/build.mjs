#!/usr/bin/env node
/**
 * Builds the heic payload directory.
 *
 *   node extensions/heic/build.mjs --out <dir>
 *
 * <dir> receives:
 *   runner.mjs    runner.ts bundled — Forge's own code only
 *   libheif.cjs   libheif-js's Emscripten glue (libheif-wasm/libheif.js), unmodified
 *   libheif.wasm  libheif + libde265 compiled to WASM, unmodified
 *   NOTICES.txt   licence texts for libheif-js, libheif and libde265 (LGPL-3.0)
 *
 * The LGPL library stays in its own two files, loaded by runner.mjs at run
 * time, so a user can replace it with their own build — not inlined in the
 * bundle. WASM is chip-independent, so the payload is the same everywhere.
 *
 * No network: everything comes from node_modules. manifest.json is not written
 * here — scripts/package-extension.mjs does that.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  // glue is CommonJS, hence .cjs: there is no package.json in the payload.
  const pkgDir = dirname(require.resolve('libheif-js/package.json'))
  copyFileSync(join(pkgDir, 'libheif-wasm', 'libheif.js'), join(out, 'libheif.cjs'))
  copyFileSync(join(pkgDir, 'libheif-wasm', 'libheif.wasm'), join(out, 'libheif.wasm'))
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  writeFileSync(
    join(out, 'NOTICES.txt'),
    notices(
      pkg.version,
      readFileSync(join(pkgDir, 'LICENSE'), 'utf8'),
      readFileSync(join(pkgDir, 'libheif-wasm', 'LICENSE'), 'utf8'),
    ),
  )
  console.log(out)
}

/**
 * LGPL compliance: the licence texts, and where the source is. libheif-js
 * ships libheif's licence file (LGPL-3.0, with the GPL-3.0 it builds on);
 * libde265, compiled into the same WASM, is LGPL-3.0 too but has no file of
 * its own in the package, so it is named here against that same text.
 */
function notices(version, jsLicence, libheifLicence) {
  return `Forge "HEIC" extension — third-party notices

libheif.cjs and libheif.wasm are libheif-js ${version}, an Emscripten (WASM)
build of libheif and libde265, unmodified. All three are licensed under the
GNU Lesser General Public License, version 3. They are the LGPL library:
runner.mjs (Forge's own code) loads them from this directory at run time, so
they can be replaced with another build of the same libheif-js version.

Source: https://github.com/catdad-experiments/libheif-js
libheif: https://github.com/strukturag/libheif
libde265: https://github.com/strukturag/libde265

----------------------------------------------------------------------------
libheif-js
----------------------------------------------------------------------------

${jsLicence}
----------------------------------------------------------------------------
libheif and libde265
----------------------------------------------------------------------------

${libheifLicence}`
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
