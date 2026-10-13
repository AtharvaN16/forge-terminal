import { Box } from 'ink'
import { useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { Choice } from '../../core/actions/index.js'
import { formatBytes } from '../../core/units.js'
import type { ExtensionId } from '../../extensions/catalog.js'
import { detailAt, type EnhanceRow, GAP_AFTER, type ToolState } from '../enhance.js'
import { titleRow } from '../quality-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, MODE_KEYS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { Select } from './Select.js'

/** E3's blank row: never a place the cursor rests. */
const GAP = '__gap__'
/** A built-in tool (Trim edges, Resize) needs nothing installed. */
const READY: ToolState = { kind: 'ready' }

/** The install byte band's width, a cell tall (G1's look for a real count). */
const BYTE_BAND = 12

/** The scale pill at the end of Boost's band: ` ‹ ` `4×` ` › `. */
const PILL = stringWidth(' ‹ 4× › ')

/** The narrowest the pane gets before its words wrap a line each. */
const PANE_MIN = 30

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
 * Enhance's picker (mockups/boost-row-2026-10.html, S1 and B3): "Enhance
 * <FORMAT>" over rows that are names — the AI tools, a blank row (E3,
 * mockups/resize-2026-10.html), then Trim edges and Resize, which are built
 * in and always ready — a quiet line to their right, and a pane beyond it
 * about the highlighted row: what the tool does, the short answer first, then
 * what you get: the size, "transparent PNG", or — for a tool not on this Mac
 * yet — the download and the key, "14.9 MB download · ↵ installs". Boost
 * resolution is one row; while it is highlighted a pill at the end of its
 * band holds the scale, and ←→ steps it. No row is a default. A row too large
 * for this image is dimmed with the reason on it. While a tool installs, the
 * pane's last line becomes the grey byte band ("6.2 of 14.9 MB"), then
 * "checking".
 */
export function EnhancePicker({
  format,
  rows,
  tools,
  checking,
  width,
  chosen,
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
  /** The row and scale chosen before, coming back from Save as: the picker opens on them. */
  chosen?: { tool?: unknown; scale?: unknown }
  /** ↵ on a row, at Boost's scale: run it, or install its tool first. */
  onChoose: (row: EnhanceRow, scale?: number) => void
  /** esc while installing. */
  onStop: () => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const stateOf = (row: EnhanceRow): ToolState | undefined =>
    row.extension ? tools[row.extension] : READY
  const items: Choice[] = rows.flatMap((r): Choice[] => {
    const state = stateOf(r)
    const reason = r.tooLarge ?? (state?.kind === 'unsupported' ? state.reason : undefined)
    const item: Choice = {
      value: r.id,
      label: r.label,
      ...(reason ? { disabled: true, hint: reason } : {}),
    }
    return r.id === GAP_AFTER ? [item, { value: GAP, label: '', hint: '', disabled: true }] : [item]
  })
  // Where Select's cursor opens: the row chosen before, else the first that can be.
  const [at, setAt] = useState(() => {
    const before = items.findIndex((i) => i.value === chosen?.tool && !i.disabled)
    return before !== -1
      ? before
      : Math.max(
          0,
          items.findIndex((i) => !i.disabled),
        )
  })
  const here = rows.find((r) => r.id === items[at]?.value)
  const hereState = here ? stateOf(here) : undefined
  const scales = here?.scales ?? []

  // Boost's scale, as an index into its row's scales. A ref too, so ↵ in the
  // same burst of keys as → reads the step already taken (Select's reasoning).
  const [opening] = useState(() =>
    Math.max(
      0,
      scales.findIndex((s) => String(s.scale) === String(chosen?.scale)),
    ),
  )
  const [step, setStep] = useState(opening)
  const stepRef = useRef(opening)
  const scale = scales[Math.min(step, scales.length - 1)]?.scale
  const installing = Object.values(tools).some((t) => t?.kind === 'installing')

  useKeys(
    (_input, key) => {
      if (key.escape) onStop()
    },
    { isActive: installing },
  )
  // ←→ step the scale only where the pill shows: Boost, installed.
  useKeys(
    (_input, key) => {
      const k = stepRef.current + (key.rightArrow ? 1 : key.leftArrow ? -1 : 0)
      if (k === stepRef.current || k < 0 || k >= scales.length) return
      stepRef.current = k
      setStep(k)
    },
    { isActive: !installing && scales.length > 1 && hereState?.kind === 'ready' },
  )

  // The list's column: the names and Boost's pill always fit, so a row never
  // wraps; a dimmed row's reason widens it while the pane keeps PANE_MIN.
  const labels = Math.max(...rows.map((r) => stringWidth(r.label)))
  const reasons = Math.max(0, ...items.map((i) => (i.disabled ? stringWidth(i.hint ?? '') : 0)))
  const least = 2 + labels + 2 + PILL + 2
  const left = Math.max(least, Math.min(2 + labels + 2 + reasons + 1, width - 3 - PANE_MIN))
  const paneWidth = Math.max(1, width - left - 3)

  const dim = colourProp(palette.dim)
  const fg = colourProp(palette.fg)

  /** Boost's scale pill, on its band while it is highlighted. */
  const pill = (item: Choice) => {
    const row = rows.find((r) => r.id === item.value)
    if (!row?.scales || scale === undefined || stateOf(row)?.kind !== 'ready') return null
    const i = Math.min(step, row.scales.length - 1)
    const chip = palette.folderChip === '' ? {} : { backgroundColor: palette.folderChip }
    const arrow = (live: boolean, text: string) => (
      <Text bold={live} color={colourProp(live ? palette.accent : palette.border)} {...chip}>
        {text}
      </Text>
    )
    return (
      <Text>
        {arrow(i > 0, ' ‹ ')}
        <Text bold color={fg} {...chip}>
          {`${scale}×`}
        </Text>
        {arrow(i < row.scales.length - 1, ' › ')}
      </Text>
    )
  }

  /** The pane's last line: what you get, or where the tool's install stands. */
  const fact = () => {
    if (!here) return null
    if (hereState?.kind === 'installing') {
      if (checking) return <Text color={dim}>checking</Text>
      const k = hereState.total > 0 ? Math.round((hereState.done / hereState.total) * BYTE_BAND) : 0
      const { got, of } = bytesOf(hereState.done, hereState.total)
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
    if (hereState?.kind === 'absent') {
      return (
        <Text>
          <Text color={dim}>{`${formatBytes(hereState.downloadBytes)} download · `}</Text>
          <Text color={fg}>↵ installs</Text>
        </Text>
      )
    }
    if (hereState === undefined) return null
    const detail = detailAt(here, scale)
    return (
      <Text>
        {detail.dim ? <Text color={dim}>{detail.dim}</Text> : null}
        {detail.bold ? (
          <Text bold color={fg}>
            {detail.bold}
          </Text>
        ) : null}
        {detail.after ? <Text color={dim}>{detail.after}</Text> : null}
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
          ...(scales.length > 1 && hereState?.kind === 'ready'
            ? ([['←→', 'scale']] as Array<[string, string]>)
            : []),
          ['↵', 'confirm'],
        ]

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Runs
          row={titleRow({
            palette,
            mode: 'enhance',
            title: `Enhance ${format}`,
            width,
          })}
        />
      </Box>
      <Box>
        <Box width={left} flexShrink={0}>
          <Select
            width={left}
            items={items}
            {...(items[at] ? { initialValue: items[at].value } : {})}
            onHighlight={setAt}
            onSubmit={(id) => {
              const row = rows.find((r) => r.id === id)
              if (!row) return
              const k = row.scales?.[Math.min(stepRef.current, row.scales.length - 1)]?.scale
              onChoose(row, k)
            }}
            onCancel={onCancel}
            isActive={!installing}
            speak={pill}
          />
        </Box>
        {here ? (
          <Box
            flexDirection="column"
            width={paneWidth + 3}
            paddingLeft={2}
            borderStyle="single"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            borderLeftColor={colourProp(palette.border)}
          >
            <Text bold color={fg}>
              {here.pane.short}
            </Text>
            <Text color={dim}>{here.pane.long}</Text>
            <Box marginTop={1}>{fact()}</Box>
          </Box>
        ) : null}
      </Box>
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
