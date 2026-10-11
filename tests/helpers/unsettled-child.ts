/**
 * Awaits something that can never settle, under guardUnsettled — the shape
 * of the old encrypted-PDF crash, where Node exited 13 ("unsettled top-level
 * await") with no Forge error at all.
 */
import { fatalLines, guardUnsettled } from '../../src/cli/fatal.js'

let settled = false
guardUnsettled(
  () => settled,
  (e) => process.stderr.write(`${fatalLines(e, false).join('\n')}\n`),
)
await new Promise<void>(() => {})
settled = true
