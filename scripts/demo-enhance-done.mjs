// Shows enhance's Done (X5) for a before/after pair, to check it by eye in
// iTerm2 / Ghostty (real pictures) and Apple Terminal (half-block close-up).
//
//   npx tsx scripts/demo-enhance-done.mjs <before> <after> [sharpen|2|4|cutout]
//
// FORGE_INLINE_IMAGES=0 forces the half-block fallback. Any key quits.
import { resolve } from 'node:path'
import { render, useInput } from 'ink'
import { createElement as h } from 'react'
import { EnhanceDone } from '../src/shell/components/EnhanceDone.tsx'
import { ThemeProvider } from '../src/shell/ThemeContext.tsx'
import { DARK } from '../src/shell/theme.ts'

const [before, after, kind = 'sharpen'] = process.argv.slice(2)
if (!before || !after) {
  console.error(
    'usage: npx tsx scripts/demo-enhance-done.mjs <before> <after> [sharpen|2|4|cutout]',
  )
  process.exit(2)
}
const op = kind === 'cutout' ? 'remove-background' : 'boost'
const scale = kind === '2' ? 2 : kind === '4' ? 4 : 1

function Demo() {
  useInput(() => app.unmount())
  return h(EnhanceDone, {
    op,
    scale,
    before: resolve(before),
    after: resolve(after),
    savedTo: resolve(after),
    width: process.stdout.columns || 80,
  })
}

const app = render(h(ThemeProvider, { palette: DARK }, h(Demo)))
await app.waitUntilExit()
