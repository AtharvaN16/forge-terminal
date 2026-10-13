import { defineConfig } from 'vitest/config'
import base from '../../vitest.config.js'

/** `npx vitest run -c scripts/key-row-audit/vitest.config.ts tests/shell` */
export default defineConfig({
  test: { ...base.test, setupFiles: ['scripts/key-row-audit/setup.ts'] },
})
