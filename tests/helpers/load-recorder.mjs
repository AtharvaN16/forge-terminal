// Preloaded with `node --import` by tests/helpers/load-log.ts. Records the URL
// of every module the process resolves and writes the list to the file named
// by FORGE_LOAD_LOG when the process exits. Verified to see modules resolved
// through tsx's own hooks, and modules loaded by plain node from a bundle.
import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const seen = new Set()

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    seen.add(resolved.url)
    return resolved
  },
})

process.on('exit', () => {
  const log = process.env.FORGE_LOAD_LOG
  if (log) writeFileSync(log, JSON.stringify([...seen]))
})
