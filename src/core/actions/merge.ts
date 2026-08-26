import { mergeOutputPath } from '../output-path.js'
import type { Job, SourceInfo } from '../types.js'
import type { Action } from './index.js'

// Page operations are pdf-only — a docx/doc has no fixed page tree to
// merge, split, extract from, delete from, or rotate.
const documents = (sources: SourceInfo[]) =>
  sources.filter((s) => s.kind === 'document' && s.format === 'pdf')

export const mergeAction: Action = {
  id: 'merge',
  label: 'Merge',
  hint: 'several files into one',
  appliesTo: (sources) =>
    documents(sources).length >= 2 && documents(sources).length === sources.length,
  unavailable: (sources) =>
    documents(sources).length !== sources.length ? 'PDFs only' : 'needs 2+ files',
  options: () => [],
  plan(sources): Job[] {
    return [{ op: 'merge', sources, outputs: [mergeOutputPath(sources.map((s) => s.path))] }]
  },
}
