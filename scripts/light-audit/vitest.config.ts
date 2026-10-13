import { defineConfig } from 'vitest/config'
import base from '../../vitest.config.js'

/** `npx vitest run -c scripts/light-audit/vitest.config.ts tests/shell` — see README.md. */
export default defineConfig({
  test: {
    ...base.test,
    setupFiles: ['scripts/light-audit/setup.ts'],
    env: { ...base.test?.env, FORCE_COLOR: '3', NO_COLOR: '' },
  },
})
