#!/usr/bin/env node
/**
 * Builds the heic payload directory.
 *
 *   node extensions/heic/build.mjs --out <dir>
 *
 * <dir> receives:
 *   runner.mjs    runner.ts bundled, with libheif-js's WASM build inlined
 *                 (its `wasm-bundle` entry) — one file, the same on every chip
 *   NOTICES.txt   licence texts for libheif-js, libheif and libde265 (LGPL-3.0)
 *
 * No network: everything comes from node_modules. manifest.json is not written
 * here — scripts/package-extension.mjs does that.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    // runner.ts and the Emscripten glue call require(), and the glue reads
    // __dirname; an ESM bundle has neither unless they are made. (The glue
    // only uses __dirname to find a .wasm file, which here is inlined.)
    banner: {
      js: "import { createRequire as __forgeRequire } from 'node:module'; import { dirname as __forgeDirname } from 'node:path'; import { fileURLToPath as __forgePath } from 'node:url'; const require = __forgeRequire(import.meta.url); const __filename = __forgePath(import.meta.url); const __dirname = __forgeDirname(__filename);",
    },
    logLevel: 'warning',
  })

  const pkgDir = dirname(require.resolve('libheif-js/package.json'))
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

runner.mjs contains libheif-js ${version}, an Emscripten (WASM) build of
libheif and libde265. All three are licensed under the GNU Lesser General
Public License, version 3.

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
