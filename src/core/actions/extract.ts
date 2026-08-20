import { extractOutputPaths, suffixedOutputPath } from '../output-path.js'
import { normalisePages, parseRanges } from '../pages.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

/**
 * The selected pages, in the one order the engine will use them
 * (`normalisePages`). A raw `values.pages` array arrives in whatever order it
 * was built — the shell's page grid appends in press order — and `plan()`
 * below names an output file per page from this list, so normalising here is
 * what keeps `doc-p5.pdf` holding page 5 rather than whichever page happened
 * to be pressed first. Normalised at this one point rather than at each
 * caller: it is the only place a page list becomes a `Job`.
 */
function selectedPages(doc: DocumentInfo, values: Record<string, unknown>): number[] {
  if (Array.isArray(values.pages)) return normalisePages(values.pages as number[])
  if (typeof values.pages === 'string') return normalisePages(parseRanges(values.pages, doc.pages))
  return []
}

const pagesOption = (doc: DocumentInfo): OptionSpec => ({
  kind: 'text',
  id: 'pages',
  label: 'Pages',
  placeholder: `1-${doc.pages}`,
})

export const extractAction: Action = {
  id: 'extract',
  label: 'Extract',
  hint: 'keep only some pages',
  appliesTo: (sources) => soleDocument(sources) !== undefined,
  unavailable: () => 'one PDF at a time',
  options: (sources) => {
    const doc = soleDocument(sources)
    if (!doc) return []
    return [
      pagesOption(doc),
      {
        kind: 'select',
        id: 'separate',
        label: 'Output',
        default: 'one',
        choices: [
          { value: 'one', label: 'One file', hint: 'all selected pages together' },
          { value: 'many', label: 'Separate files', hint: 'one per page' },
        ],
      },
    ]
  },
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    const pages = selectedPages(doc, values)
    const separate = values.separate === 'many'
    return [
      {
        op: 'extract',
        sources: [doc],
        outputs: extractOutputPaths(doc.path, pages, separate),
        pages,
        separate,
      },
    ]
  },
}

export const deleteAction: Action = {
  id: 'delete',
  label: 'Delete',
  hint: 'drop some pages',
  appliesTo: (sources) => soleDocument(sources) !== undefined,
  unavailable: () => 'one PDF at a time',
  options: (sources) => {
    const doc = soleDocument(sources)
    return doc ? [pagesOption(doc)] : []
  },
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    return [
      {
        op: 'delete',
        sources: [doc],
        outputs: [suffixedOutputPath(doc.path, 'trimmed')],
        pages: selectedPages(doc, values),
      },
    ]
  },
}
