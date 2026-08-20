import { extractOutputPaths, suffixedOutputPath } from '../output-path.js'
import { parseRanges } from '../pages.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

function selectedPages(doc: DocumentInfo, values: Record<string, unknown>): number[] {
  if (Array.isArray(values.pages)) return values.pages as number[]
  if (typeof values.pages === 'string') return parseRanges(values.pages, doc.pages)
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
