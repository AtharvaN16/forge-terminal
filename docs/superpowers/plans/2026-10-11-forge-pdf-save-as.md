# /pdf Save as Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `/pdf` page operation ends on Save as, as convert and compress do, so you choose where the result goes and what it is called.

**Architecture:** Core gains one pure helper, `placeOutputs`, which moves an action's planned outputs into a chosen folder and, for a single output, renames it. Every page action's `plan()` passes `values.destination` and `values.name` through it. A shared `destinationOption` in core lists the folders, so the shell never hardcodes them. In the shell, `PdfFlow`'s `confirm` step becomes Save as (`SaveAs.tsx`, unchanged apart from a title aside). Merge's own rename goes. A refused write's Cancel reopens Save as on the folder.

**Tech Stack:** TypeScript, Ink 7, React 19, vitest, biome.

**Spec:** the decided Save as design, `mockups/flow-parts-2-2026-10.html` tab "7 · Naming ✓" (P1), as built for convert/compress in commit `4cadebd`, plus these decisions (2026-10-11):
- Save as replaces /pdf's confirm screen. ↵ in Save as runs the job. The confirm sentence ("Rotate 90°") moves to the title's right as its aside.
- /pdf opens on the configured default folder, like convert and compress.
- An operation writing one file gets an editable name. One writing many files (split, extract to separate files) opens on the folder with the names fixed: `report-01.pdf … 4 files`.
- Merge's `n` rename inside the file order list goes, so a file is named in one place only.

## Global Constraints

- `core/` and `engines/` import no React, no Ink, no Chalk, and never write to stdout (CLAUDE.md invariant 1).
- No hardcoded list of output formats or folders in the shell. The folders come from core (`destinationOption`), as convert's do from `options()` (invariant 2).
- Writes stay atomic (invariant 6): `core/atomic.ts` already creates a missing folder (`mkdir -p`) before the rename.
- The CLI and MCP stay as they are. They never pass `destination` or `name`, so `placeOutputs` is a no-op for them. `--output` stays refused for page operations (`src/cli/args.ts:444-454`).
- Work on `dev`. Run `npm run lint`, `npm run typecheck` and `npx vitest run` before each commit.
- Each test walking the shell waits for the screen it needs (`until(lastFrame, text)`, then a 100 ms beat) rather than sleeping a fixed time. See `tests/shell/app-convert.test.tsx` for the helper.

## Review Focus

1. **A folder typed as `~/out`** reaches `placeOutputs` unexpanded: the shell must `expandTilde` before planning, or the file lands in a folder literally named `~`. Task 3 adds the test.
2. **A name typed with a `/`, or spaces at the ends** is trimmed, and `/` becomes `-`, as in convert. An empty name means the proposed one. Task 3 adds the test.
3. **A name typed for a merge across two folders**: the output goes into the chosen folder, not the first file's. Task 1 adds the test.
4. **Cancel on "already exists"** returns to Save as on the folder with the typed name kept, not to the /pdf hub. Task 4 adds the test.
5. **esc from Save as** goes back exactly where confirm's esc went (`backFromConfirm`): split to its mode picker, merge to its order, the others to their last option. Task 3 adds the test.

---

### Task 1: Core places page-operation outputs where Save as says

**Files:**
- Create: `src/core/actions/destination.ts`
- Modify: `src/core/output-path.ts` (add `placeOutputs`)
- Modify: `src/core/actions/{rotate,merge,split,extract}.ts` (every `plan()`; extract.ts also holds delete)
- Modify: `src/core/actions/compress.ts`, `src/core/actions/convert.ts` (use `destinationOption`, deleting their private `destinationPath` and `labelFor`)
- Test: `tests/core/output-path.test.ts`, `tests/core/actions-pages.test.ts`, `tests/core/destination.test.ts` (new)

**Interfaces:**
- Produces: `placeOutputs(outputs: string[], destination?: string, name?: string): string[]`
- Produces: `destinationOption(source: SourceInfo, prefs: Preferences, opts?: { subfolder?: boolean }): Extract<OptionSpec, { kind: 'path' }>`
- Produces: page actions read `values.destination` (absolute folder) and `values.name` (stem, no extension).

- [ ] **Step 1: Write the failing tests**

`tests/core/output-path.test.ts`, appended:

```ts
describe('placeOutputs', () => {
  it('leaves outputs where plan() put them when no folder or name is given', () => {
    expect(placeOutputs(['/a/doc-rotated.pdf'])).toEqual(['/a/doc-rotated.pdf'])
  })
  it('moves every output into the chosen folder, names kept', () => {
    expect(placeOutputs(['/a/doc-1.pdf', '/a/doc-2.pdf'], '/out')).toEqual([
      '/out/doc-1.pdf',
      '/out/doc-2.pdf',
    ])
  })
  it('renames a single output, keeping its extension', () => {
    expect(placeOutputs(['/a/doc-rotated.pdf'], '/out', 'final')).toEqual(['/out/final.pdf'])
  })
  it('ignores a name when there are many outputs, which no one name can cover', () => {
    expect(placeOutputs(['/a/doc-1.pdf', '/a/doc-2.pdf'], undefined, 'x')).toEqual([
      '/a/doc-1.pdf',
      '/a/doc-2.pdf',
    ])
  })
})
```

`tests/core/actions-pages.test.ts`, appended (reuse the file's existing PDF fixture helpers; `DOC` below stands for its one-PDF `DocumentInfo`, and `DOC_IN_A`/`DOC_IN_B` for two PDFs in different folders):

```ts
describe('page operations honour Save as', () => {
  it('rotate writes the named file in the chosen folder', () => {
    const [job] = rotateAction.plan([DOC], { degrees: '90', destination: '/out', name: 'turned' })
    expect(job?.outputs).toEqual(['/out/turned.pdf'])
  })
  it('split keeps its numbered names in the chosen folder', () => {
    const [job] = splitAction.plan([DOC], { cuts: [0], destination: '/out' })
    expect(job?.outputs.every((o) => o.startsWith('/out/'))).toBe(true)
  })
  it('merge across two folders lands in the chosen one, under the typed name', () => {
    const [job] = mergeAction.plan([DOC_IN_A, DOC_IN_B], { destination: '/out', name: 'all' })
    expect(job?.outputs).toEqual(['/out/all.pdf'])
  })
  it('delete and single-file extract take a name; separate extract does not', () => {
    expect(deleteAction.plan([DOC], { pages: '1', destination: '/o', name: 'n' })[0]?.outputs).toEqual(['/o/n.pdf'])
    expect(extractAction.plan([DOC], { pages: '1', destination: '/o', name: 'n' })[0]?.outputs).toEqual(['/o/n.pdf'])
    const many = extractAction.plan([DOC], { pages: '1-2', separate: 'many', destination: '/o', name: 'n' })[0]
    expect(many?.outputs.map((o) => o.split('/').pop())).not.toContain('n.pdf')
  })
})
```

`tests/core/destination.test.ts` (new):

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { destinationOption } from '../../src/core/actions/destination.js'

const source = { path: '/work/scans/doc.pdf' } as Parameters<typeof destinationOption>[0]

describe('destinationOption', () => {
  it('opens on the configured default, listed first', () => {
    const spec = destinationOption(source, { ...DEFAULT_PREFERENCES, defaultOutput: '/work/out' })
    expect(spec.default).toBe('/work/out')
    expect(spec.presets[0]?.path).toBe('/work/out')
  })
  it('lists the source folder as Same folder, and the default once only', () => {
    const spec = destinationOption(source, { ...DEFAULT_PREFERENCES, defaultOutput: join(homedir(), 'Desktop') })
    expect(spec.presets.map((p) => p.label)).toEqual(['Desktop', 'Same folder', 'Downloads'])
  })
  it('offers New subfolder only when asked (convert)', () => {
    const spec = destinationOption(source, DEFAULT_PREFERENCES, { subfolder: true })
    expect(spec.presets.at(-1)).toEqual({ label: 'New subfolder', path: '/work/scans/converted' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/output-path.test.ts tests/core/actions-pages.test.ts tests/core/destination.test.ts`
Expected: FAIL. `placeOutputs` isn't exported, `destination.js` can't be found, and the outputs stay beside the source.

- [ ] **Step 3: Implement**

`src/core/output-path.ts`:

```ts
/**
 * Where Save as puts a page operation's outputs: into `destination` when one
 * was chosen, names kept, and, when there is exactly one output, under `name`
 * with its own extension. Many outputs keep their numbered names, which no
 * one name can stand for. Nothing given: the outputs stay where plan() put them.
 */
export function placeOutputs(outputs: string[], destination?: string, name?: string): string[] {
  const placed = destination ? outputs.map((o) => join(destination, basename(o))) : outputs
  const [only] = placed
  if (!name || placed.length !== 1 || only === undefined) return placed
  return [join(dirname(only), `${name}${extname(only)}`)]
}
```

`src/core/actions/destination.ts`: move `labelFor` and `destinationPath` from `convert.ts` here as `destinationOption(source, prefs, { subfolder })`. Push the `New subfolder` candidate only when `subfolder` is true. Keep the dedupe and its comment. Convert calls it with `{ subfolder: true }`; compress calls it without, and the page actions are wired in Task 3.

Each page action's `plan()` wraps its outputs:

```ts
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
// rotate
outputs: placeOutputs([suffixedOutputPath(doc.path, 'rotated')], str(values.destination), str(values.name)),
```

Do the same in merge (its `plan` gains `values`), split, extract (one and many) and delete. Put `str` in `destination.ts` and export it, rather than repeating it five times.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core tests/cli tests/mcp`
Expected: PASS. CLI and MCP are untouched.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core
git commit -m "feat(core): page operations can be saved to a chosen folder and name"
```

### Task 2: Save as can say what it is about to do

**Files:**
- Modify: `src/shell/components/SaveAs.tsx` (prop `aside?: string`, passed to `titleRow`)
- Test: `tests/shell/save-as.test.tsx`

**Interfaces:**
- Produces: `<SaveAs aside="Rotate 90°" … />` draws the title as `titleRow({ …, title: 'Save as', aside })`.

- [ ] **Step 1: Write the failing test**

```ts
it('says what the job will do at the title’s right, quietly', () => {
  const out = plain(render(<Harness aside="Rotate 90°" />).lastFrame())
  expect(out.split('\n')[0]).toMatch(/^ Save as +Rotate 90°$/)
})
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npx vitest run tests/shell/save-as.test.tsx -t "title’s right"`. Expected: FAIL, no aside drawn.
- [ ] **Step 3: Implement.** Add `aside?: string | undefined` to the props and pass `aside` into the existing `titleRow` call.
- [ ] **Step 4: Run `npx vitest run tests/shell/save-as.test.tsx` and verify it passes.** Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): Save as can name the job at its title's right"`

### Task 3: /pdf ends on Save as

**Files:**
- Modify: `src/shell/flows/pdf.tsx` (`confirm` step → Save as; remove the unreachable `slider`/`path` branches and their `Slider`/`PathInput` imports; `planJobs` loses `mergeOutputOverride`)
- Modify: `src/shell/components/MergeList.tsx` (remove `n` rename: `renaming`, `stemText`, `customStem`, the "Name the output" prompt; `onSubmit(ordered)` only)
- Modify: `src/shell/trail.ts` (`PDF_SCREENS.confirm`: `'Confirm'` → `'Save as'`)
- Delete: `src/shell/components/PathInput.tsx`, `tests/shell/path-input.test.tsx`, the PathInput flash test in `tests/shell/motion-surfaces.test.tsx`. Nothing reaches PathInput once /pdf uses Save as.
- Test: `tests/shell/pdf-flow.test.tsx`, `tests/shell/merge-list.test.tsx`, `tests/shell/pdf-flow-app.test.tsx`, `tests/shell/trail.test.ts`

**Interfaces:**
- Consumes: `placeOutputs` semantics and `destinationOption` (Task 1); `SaveAs` with `aside` (Task 2).
- Produces: `PdfFlow` props gain `resume?: PdfResume` and `onDone(jobs: Job[], resume: PdfResume)`, where
  `export interface PdfResume { actionId: string; values: Record<string, unknown>; mergeOrder?: SourceInfo[] }`. `values` includes `destination` and `name`. Task 4 uses it.

- [ ] **Step 1: Write the failing tests** (`pdf-flow.test.tsx`; follow the file's existing render and stage helpers, and wait on screens with `until`):

```ts
it('ends rotate on Save as: the job at the title’s right, the name editable, ↵ runs it', async () => {
  // hub → Rotate → 90° right → Save as
  expect(plain(lastFrame())).toMatch(/^ Save as +Rotate 90°$/m)
  expect(plain(lastFrame())).toContain('› doc-rotated.pdf   in ')
  stdin.write('X'); stdin.write(ENTER)
  expect(onDone.mock.calls[0][0][0].outputs).toEqual([join(DEFAULT_OUT, 'doc-rotatedX.pdf')])
})
it('opens split on the folder with the names fixed', async () => {
  // hub → Split → Every page (3-page doc)
  expect(plain(lastFrame())).toContain('› doc-1.pdf … 3 files   in ')
  expect(plain(lastFrame())).toMatch(/esc back · ctrl-c quit/)
})
it('expands ~ in a typed folder before planning', async () => {
  // at Save as: tab, type ~/forge-pdf-out, ↵
  expect(onDone.mock.calls[0][0][0].outputs[0].startsWith(join(homedir(), 'forge-pdf-out'))).toBe(true)
})
it('trims a typed name and turns / into -', async () => {
  // hub → Rotate → 90° right → Save as
  stdin.write(CTRL_U); await settle()
  stdin.write('  a/b  '); await settle()
  stdin.write(ENTER); await settle()
  expect(basename(onDone.mock.calls[0][0][0].outputs[0])).toBe('a-b.pdf')
})
it('esc from Save as goes where confirm’s esc went: split to its mode, merge to its order', async () => {
  // Split → Every page → Save as (opens on the folder): esc → the "How" picker
  stdin.write(ESC); await until(lastFrame, 'Every N pages')
  // Merge (two PDFs staged) → ↵ in the order list → Save as: esc → name, esc (empty) → the order list
  stdin.write(ESC); stdin.write(CTRL_U); stdin.write(ESC); await until(lastFrame, 'order the files')
})
```

`merge-list.test.tsx`: replace the rename tests with one asserting `n` does nothing and `onSubmit` is called with the order alone.
`trail.test.ts`: `pdfTrail({ step: 'confirm', … }).current` is `'Save as'`.

- [ ] **Step 2: Run them to verify they fail.** Run: `npx vitest run tests/shell/pdf-flow.test.tsx tests/shell/merge-list.test.tsx tests/shell/trail.test.ts`. Expected: FAIL, because the confirm screen is still drawn.

- [ ] **Step 3: Implement.** In `PdfFlow`:
  - Add state `saveName: string` (the typed stem), `saveFolder: string` (initially `destinationOption(firstSource, prefs).default`) and `edited: boolean`.
  - `jobs` = `planJobs(action, sources, { ...values, destination: saveFolder, name: edited && saveName ? clean(saveName) : undefined }, mergeOrder)`, where `clean = (s) => s.trim().replace(/\//g, '-')`.
  - The proposal is `planJobs(...)` without a name: an editable stem when there is one output, else `fixedName = \`${basename(outputs[0])} … ${outputs.length} files\``.
  - Render `<SaveAs>` for `step === 'confirm'` with `aside={describeJob(job)}`, `presets` from `destinationOption`, `defaultPath={expandTilde(prefs.defaultOutput)}` and `display={displayPath}`.
  - Wire `onFolder` to set `saveFolder` and, if not edited, reset the name to the new proposal. Wire `onMakeDefault` through a new `PdfFlowProps.onMakeDefault`, which App passes as its `makeDefault`.
  - `onSubmit(folder, typed)` calls `onDone(planned, resume)` with `folder` run through `expandTilde`. `onBack` is `backFromConfirm`.
  - Delete the confirm `useKeys`, the confirm render block and the dead `slider`/`path` branches.

  In `MergeList`, delete the rename state, keys, prompt and hint. `onSubmit(orderRef.current)`.

- [ ] **Step 4: Run `npx vitest run tests/shell` and verify it passes.** Expected: PASS. Update any test still asserting the old confirm screen (`↵ run`, "Merge — … Name the output") to the Save as screen.

- [ ] **Step 5: Commit.** `git commit -am "feat(shell): /pdf ends on Save as; merge names its file there"`

### Task 4: A refused /pdf write goes back to Save as

**Files:**
- Modify: `src/shell/App.tsx` (`PdfFlow` mount and `handlePdfDone`/`answerPdfBlocked`: keep `PdfResume`; Cancel reopens `PdfFlow` with `resume`; Cancel hint "pick a different folder, nothing written" for both kinds)
- Modify: `src/shell/flows/pdf.tsx` (`resume` prop: start at `step: 'confirm'` with action, values, merge order, folder and name restored, and Save as on the folder)
- Test: `tests/shell/pdf-flow-app.test.tsx`

**Interfaces:**
- Consumes: `PdfResume`, `onDone(jobs, resume)` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
it('cancelling "already exists" returns to Save as on the folder, the name kept', async () => {
  // stage doc.pdf, with doc-rotated.pdf already in the default folder; Rotate → 90° → ↵ at Save as
  await until(lastFrame, 'File already exists')
  stdin.write(ENTER) // Cancel, the first row
  await until(lastFrame, 'Save as')
  expect(plain(lastFrame())).toContain('› doc-rotated.pdf   in ')
  expect(plain(lastFrame())).toMatch(/esc name · ctrl-c quit/)
  expect((await readdir(dir)).sort()).toEqual(['doc-rotated.pdf', 'doc.pdf'])
})
```

- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, because Cancel lands on the hub ("PDF — choose an operation").
- [ ] **Step 3: Implement.**
  - In App, add `const [pdfResume, setPdfResume] = useState<PdfResume | undefined>()`. `onDone={(jobs, resume) => { setPdfResume(resume); void handlePdfDone(jobs) }}`.
  - On Cancel with `cancelTo === 'pdf'`, `setStep('pdf')` remounts `PdfFlow`, keyed so that it does. Pass `resume={pdfResume}`.
  - Clear `pdfResume` when the run finishes or a new session starts (`startNewSession`).
  - In `PdfFlow`, initialise each state from `resume` when given, with `initialFocus="folder"`.
- [ ] **Step 4: Run `npx vitest run` and verify it passes.** Then run `npm run lint && npm run typecheck`. Expected: all green.
- [ ] **Step 5: Commit.** `git commit -am "feat(shell): a refused /pdf write returns to Save as"`
