import { type Finished, finishNotice, type Notice } from '../core/finish-notice.js'
import { postFinishNotice } from '../menu/notify.js'
import type { ShellMode } from './theme.js'

/** Each mode's name in a run's notice, as home's tabs say it: "PDF finished". */
export const NOTICE_VERBS: Record<ShellMode, string> = {
  convert: 'Convert',
  compress: 'Compress',
  pdf: 'PDF',
  edit: 'Edit',
  transcribe: 'Transcribe',
  colour: 'Colour',
}

/**
 * A run in the app has ended: its notice goes to the poster, which says it
 * only if it took 20 seconds and the terminal is not in front
 * (`postFinishNotice`). Never waited on: Done is already on screen.
 */
export function noticeRun(
  verb: string,
  startedAt: number,
  run: Finished,
  d: {
    now?: () => number
    post?: (notice: Notice | undefined, elapsedMs: number) => Promise<void>
  } = {},
): void {
  const post = d.post ?? postFinishNotice
  void post(finishNotice(verb, run), (d.now ?? Date.now)() - startedAt)
}
