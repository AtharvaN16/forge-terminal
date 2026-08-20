import { invalidArguments } from '../errors.js'
import { splitOutputPaths } from '../output-path.js'
import { cutsToRanges } from '../pages.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

export const splitAction: Action = {
  id: 'split',
  label: 'Split',
  hint: 'into several files',
  appliesTo: (sources) => (soleDocument(sources)?.pages ?? 0) > 1,
  unavailable: (sources) =>
    soleDocument(sources) === undefined ? 'one PDF at a time' : 'only one page',
  options(sources): OptionSpec[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    return [
      {
        kind: 'select',
        id: 'mode',
        label: 'How',
        default: 'every-page',
        choices: [
          { value: 'every-page', label: 'Every page', hint: `${doc.pages} files` },
          { value: 'every-n', label: 'Every N pages', hint: 'ask how many' },
          { value: 'points', label: 'At points I choose', hint: 'grid' },
        ],
      },
    ]
  },
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    const cuts = Array.isArray(values.cuts) ? (values.cuts as number[]) : []
    const parts = cutsToRanges(cuts, doc.pages).length
    return [{ op: 'split', sources: [doc], outputs: splitOutputPaths(doc.path, parts), cuts }]
  },
}

/** Cuts after every page — what "every page" means. */
export function everyPageCuts(pages: number): number[] {
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i)
}

/**
 * Cuts every `n` pages, so a 25-page document at n=10 gives 10, 10, 5.
 *
 * A step below 1 never advances the loop: it used to run until the array hit
 * its maximum length and then throw a bare `RangeError`, which `src/index.ts`
 * rethrows as a stack trace. Both front ends validate before calling — the
 * shell in `flows/pdf.tsx`, the CLI in `cli/args.ts` — so this is a backstop,
 * and it refuses rather than returning "no cuts": a single-part split is a
 * plausible-looking answer to a question nobody asked, which is worse than a
 * refusal a caller can render.
 */
export function everyNCuts(pages: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw invalidArguments('Splitting every N pages needs N to be a whole number, at least 1.')
  }
  const cuts: number[] = []
  for (let p = n; p < pages; p += n) cuts.push(p - 1)
  return cuts
}
