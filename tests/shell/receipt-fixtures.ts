import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Result, SourceInfo } from '../../src/core/types.js'

export const DESKTOP = join(homedir(), 'Desktop')

export const receiptSource = (over: Partial<SourceInfo> = {}): SourceInfo =>
  ({
    kind: 'image',
    path: join(DESKTOP, 'test.png'),
    format: 'png',
    width: 2756,
    height: 774,
    bytes: 122_449,
    hasAlpha: true,
    frames: 1,
    ...over,
  }) as SourceInfo

export const receiptResult = (
  over: { source?: Partial<SourceInfo>; out?: string; bytes?: number; warnings?: string[] } = {},
): Result => ({
  job: {
    op: 'convert',
    sources: [receiptSource(over.source)],
    outputs: [over.out ?? join(DESKTOP, 'test.jpg')],
    target: 'jpeg',
    options: { background: '#ffffff', keepMetadata: false },
  },
  outputBytes: over.bytes ?? 76_390,
  warnings: (over.warnings ?? []).map((message) => ({ code: 'animation-flattened', message })),
})
