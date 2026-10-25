import { Box } from 'ink'
import { useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { Choice } from '../../core/actions/index.js'
import { formatBytes } from '../../core/units.js'
import type { ExtensionId } from '../../extensions/catalog.js'
import { detailAt, type EditRow, GAP_AFTER, pillOf, type ToolState } from '../edit.js'
import { HOME_MARGIN, type Row } from '../home-art.js'
import { titleRow } from '../quality-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeColours } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { Select } from './Select.js'
import { pillWidth, StepPill } from './StepPill.js'

/** E3's blank row: never a place the cursor rests. */
const GAP = '__gap__'
/** A built-in tool (Trim edges, Resize) needs nothing installed. */
const READY: ToolState = { kind: 'ready' }

/** The install byte band's width, a cell tall (G1's look for a real count). */
const BYTE_BAND = 12

/**
 * What a tool still needs, in the words of the row over the keys
 * (mockups/own-tools-2026-10-round5.html, F3): Boost's model, Remove
 * background's helper.
 */
const NEEDS: Partial<Record<ExtensionId, string>> = {
  boost: 'its on-device model',
  'remove-background': 'its helper',
}

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
 * Edit's picker (mockups/boost-row-2026-10.html, S1 and B3): "Edit
 * <FORMAT>" over rows that are names — the AI tools, a blank row (E3,
 * mockups/resize-2026-10.html), then Trim edges and Resize, which are built
 * in and always ready — a quiet line to their right, and a pane beyond it
 * about the highlighted row: what the tool does, the short answer first, then
 * what you get: the size, "transparent PNG", or — for a tool not on this Mac
 * yet — the download and the key, "14.9 MB download · ↵ installs". Boost
 * resolution is one row; while it is highlighted a pill at the end of its
 * band holds the scale, and ←→ steps it. Crop to shape carries the same pill
 * for its shape (mockups/crop-2026-10.html) — one pill, any row with steps
 * (`pillOf`), each row keeping its own step. No row is a default. A row too large
 * for this image is dimmed with the reason on it. While a tool installs, the
 * pane's last line becomes the grey byte band ("6.2 of 14.9 MB"), then
 * "checking".
 */
export function EditPicker({
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
  rows: EditRow[]
  /** Where each extension stands; undefined while it is being read. */
  tools: Partial<Record<ExtensionId, ToolState>>
  /** Every byte is in and the archive is being checked. */
  checking: boolean
  width: number
  /**
   * The row and its pill's step chosen before (Boost's scale, Crop's shape),
   * coming back from a later screen: the picker opens on them.
   */
  chosen?: { tool?: unknown; step?: unknown }
  /** ↵ on a row, at its pill's step (Boost's scale, Crop's shape): run it, or install its tool first. */
  onChoose: (row: EditRow, step?: number | string) => void
  /** esc while installing. */
  onStop: () => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const stateOf = (row: EditRow): ToolState | undefined =>
    row.extension ? tools[row.extension] : READY
  // Where a tool has no row (Linux has no Boost), the blank row follows the
  // last AI row there is, so it still splits AI from built-in.
  const gapAfter =
    rows.find((r) => r.gapAfter)?.id ??
    (rows.some((r) => r.id === GAP_AFTER) ? GAP_AFTER : rows.filter((r) => r.extension).at(-1)?.id)
  const items: Choice[] = rows.flatMap((r): Choice[] => {
    const state = stateOf(r)
    const reason = r.tooLarge ?? (state?.kind === 'unsupported' ? state.reason : undefined)
    const item: Choice = {
      value: r.id,
      label: r.label,
      ...(reason ? { disabled: true, hint: reason } : {}),
    }
    return r.id === gapAfter ? [item, { value: GAP, label: '', hint: '', disabled: true }] : [item]
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
  const pill = here ? pillOf(here) : undefined
  const steps = pill?.steps ?? []

  // Each row's place on its pill, as an index into its steps, by row id. A
  // ref too, so ↵ in the same burst of keys as → reads the step already
  // taken (Select's reasoning).
  const [opening] = useState(() => {
    const row = rows.find((r) => r.id === chosen?.tool)
    const k = row
      ? (pillOf(row)?.steps.findIndex((s) => String(s.value) === String(chosen?.step)) ?? -1)
      : -1
    return row && k > 0 ? { [row.id]: k } : {}
  })
  const [placed, setPlaced] = useState<Record<string, number>>(opening)
  const placedRef = useRef<Record<string, number>>(opening)
  /** Where `row` stands on its pill: its index, within its steps. */
  const indexOf = (row: EditRow, n: number) => Math.min(placedRef.current[row.id] ?? 0, n - 1)
  const stepNow = here
    ? steps[Math.max(0, Math.min(placed[here.id] ?? 0, steps.length - 1))]
    : undefined
  const installing = Object.values(tools).some((t) => t?.kind === 'installing')

  useKeys(
    (_input, key) => {
      if (key.escape) onStop()
    },
    { isActive: installing },
  )
  // ←→ step the pill only where it shows: a row with steps, its tool installed.
  useKeys(
    (_input, key) => {
      if (!here) return
      const from = indexOf(here, steps.length)
      const k = from + (key.rightArrow ? 1 : key.leftArrow ? -1 : 0)
      if (k === from || k < 0 || k >= steps.length) return
      placedRef.current = { ...placedRef.current, [here.id]: k }
      setPlaced(placedRef.current)
    },
    { isActive: !installing && steps.length > 1 && hereState?.kind === 'ready' },
  )

  // The list's column: the names and the widest pill always fit, so a row
  // never wraps; a dimmed row's reason widens it while the pane keeps PANE_MIN.
  const labels = Math.max(...rows.map((r) => stringWidth(r.label)))
  const reasons = Math.max(0, ...items.map((i) => (i.disabled ? stringWidth(i.hint ?? '') : 0)))
  const pills = Math.max(
    pillWidth('4×'),
    ...rows.flatMap((r) => pillOf(r)?.steps.map((s) => pillWidth(s.label)) ?? []),
  )
  const least = 2 + labels + 2 + pills + 2
  // The list starts on the margin (Select indents itself) and the pane ends on
  // the other one (2026-10-20).
  // The pane gives the margins up, not the list: a dimmed row's reason is
  // said in full with its space before the line.
  const left = Math.max(least, Math.min(2 + labels + 2 + reasons + 1, width - 3 - PANE_MIN))
  const paneWidth = Math.max(1, width - left - 3 - 2 * HOME_MARGIN)

  const dim = colourProp(palette.dim)
  const fg = colourProp(palette.fg)

  /** The highlighted row's pill (Boost's scale, Crop's shape), at its band's far end. */
  const pillFor = (item: Choice) => {
    const row = rows.find((r) => r.id === item.value)
    const own = row ? pillOf(row) : undefined
    if (!row || !own || own.steps.length === 0 || stateOf(row)?.kind !== 'ready') return null
    return <StepPill labels={own.steps.map((s) => s.label)} at={placed[row.id] ?? 0} />
  }

  /** The pane's last line: what you get, or where the tool's install stands. */
  const fact = () => {
    if (!here) return null
    // A tool still to install says so on the row over the keys, not here.
    if (hereState?.kind === 'installing' || hereState?.kind === 'absent') return null
    if (hereState === undefined) return null
    const detail = detailAt(here, stepNow?.value)
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

  /**
   * The row over the keys while the highlighted tool is not on this Mac
   * (F3): what it needs and its size, ↵ install at the far end in edit's
   * colour; then the byte band on the same row, then "checking".
   */
  const needRow = (): Row | undefined => {
    if (!here) return undefined
    if (hereState?.kind === 'absent') {
      const what = here.extension ? (NEEDS[here.extension] ?? 'a download') : 'a download'
      return [
        { text: `${here.label} needs ${what}`, fg: palette.dim },
        { text: ' · ', fg: palette.border },
        { text: formatBytes(hereState.downloadBytes), fg: palette.fg, bold: true },
        { text: ' download', fg: palette.dim },
      ]
    }
    if (hereState?.kind === 'installing') {
      const lead = { text: `Installing ${here.label}  `, fg: palette.dim }
      if (checking) return [lead, { text: 'checking', fg: palette.dim }]
      const k =
        hereState.total > 0
          ? Math.round(Math.min(1, hereState.done / hereState.total) * BYTE_BAND)
          : 0
      const { got, of } = bytesOf(hereState.done, hereState.total)
      const band: Row =
        palette.track === '' || palette.trackFill === ''
          ? [{ text: `${'━'.repeat(k)}${'─'.repeat(BYTE_BAND - k)}`, fg: palette.dim }]
          : [
              { text: ' '.repeat(k), bg: palette.trackFill },
              { text: ' '.repeat(BYTE_BAND - k), bg: palette.track },
            ]
      return [
        lead,
        ...band,
        { text: `  ${got}`, fg: palette.fg, bold: true },
        { text: ` of ${of}`, fg: palette.dim },
      ]
    }
    return undefined
  }
  const need = needRow()
  const chip: Row =
    palette.keycapBg === '' || (process.env.NO_COLOR ?? '') !== ''
      ? [{ text: '[↵ install]', fg: palette.border }]
      : [{ text: ' ↵ install ', fg: palette.ink, bg: modeColours(palette, 'edit').fg, bold: true }]
  const hint = need ? (
    <Box width={width} paddingX={HOME_MARGIN} justifyContent="space-between">
      <Runs row={need} />
      {hereState?.kind === 'absent' ? <Runs row={chip} /> : null}
    </Box>
  ) : undefined

  const main: Array<[string, string]> = installing
    ? [['esc', 'stop']]
    : hereState?.kind === 'absent'
      ? [
          ['↑↓', 'choose'],
          ['↵', 'install'],
        ]
      : [
          ['↑↓', 'choose'],
          ...(pill && steps.length > 1 && hereState?.kind === 'ready'
            ? ([['←→', pill.noun]] as Array<[string, string]>)
            : []),
          ['↵', 'confirm'],
        ]

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Runs
          row={titleRow({
            palette,
            mode: 'edit',
            title: `Edit ${format}`,
            width,
          })}
        />
      </Box>
      <Box>
        <Box width={left + HOME_MARGIN} flexShrink={0}>
          <Select
            width={left}
            items={items}
            {...(items[at] ? { initialValue: items[at].value } : {})}
            onHighlight={setAt}
            onSubmit={(id) => {
              const row = rows.find((r) => r.id === id)
              if (!row) return
              const own = pillOf(row)?.steps ?? []
              onChoose(row, own[Math.max(0, indexOf(row, own.length))]?.value)
            }}
            onCancel={onCancel}
            isActive={!installing}
            speak={pillFor}
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
        hint={hint}
        pairs={main}
        foot={[
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}
