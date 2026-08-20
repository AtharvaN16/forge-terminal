import type { Action } from './index.js'

/**
 * Filled in by a later task. Registered now so the module graph is complete
 * and `ACTIONS` has both entries from the start.
 */
export const compressAction: Action = {
  id: 'compress',
  label: 'Compress',
  hint: 'make it smaller',
  appliesTo: () => false,
  options: () => [],
  plan: () => [],
}
