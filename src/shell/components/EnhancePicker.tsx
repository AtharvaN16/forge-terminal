import { Box, Text } from 'ink'
import { useState } from 'react'
import type { Choice } from '../../core/actions/index.js'
import { formatBytes } from '../../core/units.js'
import type { ExtensionId } from '../../extensions/catalog.js'
import type { EnhanceRow, ToolState } from '../enhance.js'
import { titleRow } from '../quality-art.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, MODE_KEYS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { Select } from './Select.js'

/** The install byte band's width, a cell tall (G1's look for a real count). */
const BYTE_BAND = 12

/**
 * "6.2 of 14.9 MB": the bytes so far in the total's own unit, so the two
 * numbers read as one measure. Real bytes from `installExtension`'s
 * `onProgress` — never a percentage of anything guessed (invariant 7).
 */
export function bytesOf(done: number, total: number): { got: string; of: string } {
  const of = formatBytes(total)
  const unit = of.split(' ')[1] ?? 'B'
  const div = unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : unit === 'KB' ? 1e3 : 1
  const got = div === 1 ? String(done) : (Math.floor((done / div) * 10) / 10).toFixed(1)
  return { got, of }
}

/**
 * Enhance's picker (mockups/extensions-2026-10.html tab "1 · Picker"): the
 * decided picker, "Enhance <FORMAT>" over four rows that are names. No row is
 * a default. Only the highlighted row says more, after the names: the size
 * you will get, "transparent PNG", or — for a tool not on this Mac yet — the
 * download and the key, "14.9 MB download · ↵ installs". A row too large for
 * this image is dimmed with the reason on it. While a tool installs, its row
 * becomes the grey byte band ("6.2 of 14.9 MB"), then "checking".
 */
export function EnhancePicker({
  format,
  rows,
  tools,
  checking,
  width,
  pickerWidth,
  onChoose,
  onStop,
  onCancel,
}: {
  /** The source's format label: "PNG". */
  format: string
  rows: EnhanceRow[]
  /** Where each extension stands; undefined while it is being read. */
  tools: Partial<Record<ExtensionId, ToolState>>
  /** Every byte is in and the archive is being checked. */
  checking: boolean
  width: number
  pickerWidth: number
  /** ↵ on a row: run it, or install its tool first. */
  onChoose: (row: EnhanceRow) => void
  /** esc while installing. */
  onStop: () => void
  onCancel: () => void
}) {
  const palette = useTheme()
  // Where Select's cursor opens: the first row that can be chosen.
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      rows.findIndex((r) => !r.tooLarge && tools[r.extension]?.kind !== 'unsupported'),
    ),
  )
  const installing = Object.values(tools).some((t) => t?.kind === 'installing')

  useKeys(
    (_input, key) => {
      if (key.escape) onStop()
    },
    { isActive: installing },
  )

  const items: Choice[] = rows.map((r) => {
    const state = tools[r.extension]
    const reason = r.tooLarge ?? (state?.kind === 'unsupported' ? state.reason : undefined)
    return {
      value: r.id,
      label: r.label,
      ...(reason ? { disabled: true, hint: reason } : {}),
    }
  })
  const here = rows[at]
  const hereState = here ? tools[here.extension] : undefined

  const speak = (item: Choice) => {
    const row = rows.find((r) => r.id === item.value)
    if (!row) return null
    const state = tools[row.extension]
    const dim = colourProp(palette.dim)
    const fg = colourProp(palette.fg)
    if (state?.kind === 'installing') {
      if (checking) return <Text color={dim}>checking</Text>
      const k = state.total > 0 ? Math.round((state.done / state.total) * BYTE_BAND) : 0
      const { got, of } = bytesOf(state.done, state.total)
      return (
        <Text>
          <Text backgroundColor={colourProp(palette.trackFill)}>{' '.repeat(k)}</Text>
          <Text backgroundColor={colourProp(palette.track)}>{' '.repeat(BYTE_BAND - k)}</Text>
          <Text>{'  '}</Text>
          <Text bold color={fg}>
            {got}
          </Text>
          <Text color={dim}>{` of ${of}`}</Text>
        </Text>
      )
    }
    if (state?.kind === 'absent') {
      return (
        <Text>
          <Text color={dim}>{`${formatBytes(state.downloadBytes)} download · `}</Text>
          <Text color={fg}>↵ installs</Text>
        </Text>
      )
    }
    if (state === undefined) return null
    return (
      <Text>
        {row.detail.dim ? <Text color={dim}>{row.detail.dim}</Text> : null}
        <Text bold color={fg}>
          {row.detail.bold}
        </Text>
        {row.detail.after ? <Text color={dim}>{row.detail.after}</Text> : null}
      </Text>
    )
  }

  const main: Array<[string, string]> = installing
    ? [['esc', 'stop']]
    : hereState?.kind === 'absent'
      ? [
          ['↑↓', 'choose'],
          ['↵', 'install'],
        ]
      : [
          ['↑↓', 'choose'],
          ['↵', 'confirm'],
        ]

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Runs
          row={titleRow({
            palette,
            mode: 'enhance',
            title: `Enhance ${format}`,
            aside: `${at + 1}/${rows.length}`,
            width,
          })}
        />
      </Box>
      <Select
        width={pickerWidth}
        items={items}
        onHighlight={setAt}
        onSubmit={(id) => {
          const row = rows.find((r) => r.id === id)
          if (row) onChoose(row)
        }}
        onCancel={onCancel}
        isActive={!installing}
        speak={speak}
        speakAt="hint"
      />
      <HintBar
        width={width}
        pairs={main}
        foot={[
          [MODE_KEYS, 'mode'],
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}
