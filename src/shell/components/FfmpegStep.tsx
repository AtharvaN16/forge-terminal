import { Box } from 'ink'
import { formatBytes } from '../../core/units.js'
import type { ToolState } from '../edit.js'
import { blank, type Row, width as widthOf } from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { useKeys } from '../useKeys.js'
import { bytesOf } from './EditPicker.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'

/** The install byte band's width, as Boost's row has it. */
const BYTE_BAND = 12

/**
 * A video or sound file on a computer with no ffmpeg (video spec §3.7): one
 * row, offered in place as Boost is — `31.4 MB download · ↵ installs`, then
 * the byte band, then `checking` — and on, the file read, to where it was
 * going. Where there is no download for this computer, the row says how to
 * get ffmpeg instead and ↵ looks again (Forge sees it the moment it is there).
 */
export function FfmpegStep({
  state,
  checking,
  how,
  onInstall,
  onLookAgain,
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
  onStop: () => void
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  const installing = state?.kind === 'installing'
  const offered = state?.kind === 'absent'
  useKeys((_input, key) => {
    if (key.escape) {
      if (installing) onStop()
      else onCancel()
    } else if (key.return && !installing) {
      if (offered) onInstall()
      else onLookAgain()
    }
  })

  const detail: Row =
    state?.kind === 'installing'
      ? checking
        ? [{ text: 'checking', fg: palette.dim }]
        : (() => {
            const k = state.total > 0 ? Math.round((state.done / state.total) * BYTE_BAND) : 0
            const { got, of } = bytesOf(state.done, state.total)
            return [
              { text: ' '.repeat(k), bg: palette.trackFill },
              { text: ' '.repeat(BYTE_BAND - k), bg: palette.track },
              blank(2),
              { text: got, fg: palette.fg, bold: true },
              { text: ` of ${of}`, fg: palette.dim },
            ]
          })()
      : state?.kind === 'absent'
        ? [
            { text: `${formatBytes(state.downloadBytes)} download · `, fg: palette.dim },
            { text: '↵ installs', fg: palette.fg },
          ]
        : [{ text: `needs ffmpeg · ${how}`, fg: palette.dim }]
  const name: Row = [
    { text: '▌', fg: palette.accent },
    blank(1),
    { text: 'Video and audio', fg: palette.fg, bold: true },
  ]
  const band = Math.max(40, width - 2)
  const row: Row = [...name, blank(Math.max(2, 36 - widthOf(name))), ...detail]
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
