import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 20_000,
    /**
     * Capped well below the machine's core count on purpose.
     *
     * Nineteen shell test files drive Ink through `ink-testing-library` and
     * wait for frames with fixed `setTimeout` sleeps — `await settle(250)` and
     * friends. Those sleeps are a bet that a render lands inside a fixed
     * wall-clock window. Saturating every core loses that bet intermittently:
     * at the default worker count this suite failed 1-5 tests per run, a
     * different set each time, all of them "expected <the previous screen> to
     * contain <the next screen's text>" — the app simply had not rendered yet.
     *
     * The real fix is a `waitFor(getFrame, predicate)` poller replacing every
     * one of those sleeps, which is ~388 call sites across those files and
     * needs doing one file at a time with each site's actual wait condition
     * made explicit. A blind sweep would make the suite faster and greener
     * while genuinely waiting for less, which is worse than the flakiness.
     *
     * Until that happens, this trades about 30 seconds of wall-clock for a
     * deterministic result. Raise it back once the sleeps are gone.
     */
    maxWorkers: 4,
  },
})
