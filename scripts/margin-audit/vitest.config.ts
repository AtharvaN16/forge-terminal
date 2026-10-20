import { defineConfig } from 'vitest/config'
import base from '../../vitest.config.js'

/** `npx vitest run -c scripts/margin-audit/vitest.config.ts tests/shell` */
export default defineConfig({
  test: { ...base.test, setupFiles: ['scripts/margin-audit/setup.ts'] },
})
