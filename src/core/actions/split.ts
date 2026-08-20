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

/** Cuts every `n` pages, so a 25-page document at n=10 gives 10, 10, 5. */
export function everyNCuts(pages: number, n: number): number[] {
  const cuts: number[] = []
  for (let p = n; p < pages; p += n) cuts.push(p - 1)
  return cuts
}
