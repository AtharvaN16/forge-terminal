import { Box } from 'ink'
import { useEffect } from 'react'
import { formatBytes } from '../../core/units.js'
import type { ToolState } from '../edit.js'
import { blank, HOME_MARGIN, type Row, width as widthOf } from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { useKeys } from '../useKeys.js'
import { bytesOf } from './EditPicker.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'

/** The install byte band's width, as Boost's row has it. */
const BYTE_BAND = 12
/** How often Forge looks for ffmpeg while the user installs it themselves. */
const POLL_MS = 2000

/**
 * A video or sound file on a computer with no ffmpeg (video spec §3.7): one
 * row, offered in place as Boost is — `31.4 MB download · ↵ installs`, then
 * the byte band, then `checking` — and on, the file read, to where it was
 * going. Where there is no download for this computer, the row says how to
 * get ffmpeg instead, and Forge looks again by itself every couple of
 * seconds — it carries on the moment ffmpeg is there (↵ looks at once).
 *
 * What is needed is said on the row over the keys, with ↵ install at its far
 * end where there is a download (mockups/own-tools-2026-10-round5.html, F4).
 */
export function FfmpegStep({
  state,
  checking,
  how,
  onInstall,
  onLookAgain,
  onPoll,
  onStop,
  onCancel,
  width,
}: {
  /** The download's state; undefined while it is read. */
  state: ToolState | undefined
  checking: boolean
  /** How to get ffmpeg where there is no download: "brew install ffmpeg". */
  how: string
  onInstall: () => void
  onLookAgain: () => void
  /** The quiet look, every couple of seconds while there is nothing to install: on, or nothing. */
  onPoll?: () => void
  onStop: () => void
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  const installing = state?.kind === 'installing'
  const offered = state?.kind === 'absent'
  const waiting = state !== undefined && !installing && !offered
  useEffect(() => {
    if (!waiting || !onPoll) return
    const timer = setInterval(onPoll, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, onPoll])
  useKeys((_input, key) => {
    if (key.escape) {
      if (installing) onStop()
      else onCancel()
    } else if (key.return && !installing) {
      if (offered) onInstall()
      else onLookAgain()
    }
  })

  /** The row over the keys: what is needed, or the download's band. */
  const need: Row | undefined =
    state?.kind === 'installing'
      ? checking
        ? [
            { text: 'Installing ffmpeg  ', fg: palette.dim },
            { text: 'checking', fg: palette.dim },
          ]
        : (() => {
            const k =
              state.total > 0 ? Math.round(Math.min(1, state.done / state.total) * BYTE_BAND) : 0
            const { got, of } = bytesOf(state.done, state.total)
            return [
              { text: 'Installing ffmpeg  ', fg: palette.dim },
              { text: ' '.repeat(k), bg: palette.trackFill },
              { text: ' '.repeat(BYTE_BAND - k), bg: palette.track },
              blank(2),
              { text: got, fg: palette.fg, bold: true },
              { text: ` of ${of}`, fg: palette.dim },
            ]
          })()
      : state?.kind === 'absent'
        ? [
            { text: 'Video needs ffmpeg', fg: palette.dim },
            { text: ' · ', fg: palette.border },
            { text: formatBytes(state.downloadBytes), fg: palette.fg, bold: true },
            { text: ' download', fg: palette.dim },
          ]
        : state === undefined
          ? undefined
          : [
              { text: 'Video needs ffmpeg', fg: palette.dim },
              { text: ' · ', fg: palette.border },
              { text: how, fg: palette.fg, bold: true },
            ]
  const chip: Row =
    palette.keycapBg === '' || (process.env.NO_COLOR ?? '') !== ''
      ? [{ text: '[↵ install]', fg: palette.border }]
      : [{ text: ' ↵ install ', fg: palette.ink, bg: palette.accent, bold: true }]
  const hint = need ? (
    <Box width={width} paddingX={HOME_MARGIN} justifyContent="space-between">
      <Runs row={need} />
      {offered ? <Runs row={chip} /> : null}
    </Box>
  ) : undefined
  const name: Row = [
    { text: '▌', fg: palette.accent },
    blank(1),
    { text: 'Video and audio', fg: palette.fg, bold: true },
  ]
  const band = Math.max(40, width - 2)
  const row: Row = name
  const padded: Row = [
    ...row.map((r) => ({ ...r, bg: r.bg ?? palette.listBand })),
    { text: ' '.repeat(Math.max(0, band - widthOf(row))), bg: palette.listBand },
  ]
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1}>
        <Runs row={[blank(1), ...padded]} />
      </Box>
      <HintBar
        width={width}
        hint={hint}
        pairs={
          installing
            ? [['esc', 'stop']]
            : offered
              ? [
                  ['↵', 'install'],
                  ['esc', 'remove file'],
                ]
              : [
                  ['↵', 'look again'],
                  ['esc', 'remove file'],
                ]
        }
      />
    </Box>
  )
}
