import { suffixedOutputPath } from '../output-path.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

export const rotateAction: Action = {
  id: 'rotate',
  label: 'Rotate',
  hint: 'turn pages',
  appliesTo: (sources) => soleDocument(sources) !== undefined,
  unavailable: () => 'one PDF at a time',
  options: (): OptionSpec[] => [
    {
      kind: 'select',
      id: 'degrees',
      label: 'Turn',
      default: '90',
      choices: [
        { value: '90', label: '90° right', hint: 'a quarter turn' },
        { value: '180', label: '180°', hint: 'upside down' },
        { value: '270', label: '90° left', hint: 'a quarter turn back' },
      ],
    },
  ],
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    const deg = Number(values.degrees ?? 90)
    const turns = ((deg / 90) % 4 || 1) as 1 | 2 | 3
    return [
      { op: 'rotate', sources: [doc], outputs: [suffixedOutputPath(doc.path, 'rotated')], turns },
    ]
  },
}
