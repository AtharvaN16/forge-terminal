import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 20_000,
    globalSetup: ['tests/helpers/temp-root.ts'],
    /**
     * The header bar's chip has slanted ends only in terminals that draw them
     * (see `slantedChips`), so its cells would depend on which terminal ran
     * the suite. Plain everywhere, unless a test asks for slants itself.
     */
    env: {
      FORGE_POWERLINE: '0',
      /**
       * No test may ask the real npm registry or write the real update cache.
       * The automatic check is off for the whole suite (src/update/check.ts);
       * the update tests pass their own environment and fakes.
       */
      FORGE_NO_UPDATE_CHECK: '1',
      /**
       * Nor touch the real right-click menu: Finder's Quick Actions in
       * ~/Library/Services, Explorer's keys in the registry. The menu tests
       * pass their own temp folders and a recording `run` (src/menu/).
       */
      FORGE_NO_MENU: '1',
      /**
       * Nor search the real Mac by name (Spotlight, ~/Desktop, ~/Downloads):
       * what it finds differs from machine to machine. The search's own tests
       * pass a temp home and ask for it (src/shell/find-files.ts).
       */
      FORGE_NO_FIND: '1',
      /**
       * Nor use the yt-dlp or ffmpeg this machine happens to have instead of
       * the fakes: which one runs would differ from machine to machine. The
       * own-tools tests pass the folders to look in (src/extensions/own.ts).
       */
      FORGE_NO_OWN_TOOLS: '1',
      /**
       * Nor post a real notification when a run takes 20 seconds
       * (src/menu/notify.ts). Its tests pass their own environment.
       */
      FORGE_NO_NOTIFY: '1',
    },
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
    // GitHub's runners have 3–4 cores, so four workers there is the
    // saturation described above; two keeps the sleeps' bet on CI.
    maxWorkers: process.env.CI ? 2 : 4,
    /**
     * A shared CI runner is slower and noisier than four workers on a laptop,
     * so those same sleeps still lose there now and then. Retry on CI only:
     * locally a failure stays a failure, so a real regression is never
     * hidden where it is being written.
     */
    retry: process.env.CI ? 2 : 0,
  },
})
