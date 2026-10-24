import { Box } from 'ink'
import { useEffect, useState } from 'react'
import stringWidth from 'string-width'
import type { Preset } from '../../core/preset.js'
import type { BarChip } from '../bar-art.js'
import { windowOver } from '../colour/system-art.js'
import { keyHint } from '../components/Done.js'
import { Runs } from '../components/Home.js'
import { ScreenBar, ScreenKeys } from '../components/MenuPopup.js'
import { chainLabels } from '../continue-editing.js'
import { blank, HOME_MARGIN, type Row, type Run } from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { modeGradient, type Palette } from '../theme.js'
import { useKeys } from '../useKeys.js'

/** What /right-click needs from outside, injectable so tests touch no Finder and no registry. */
export interface RightClickSystem {
  /** Whether Forge is in the right-click menu now. */
  isOn(): Promise<boolean>
  /** Puts it there, and keeps it there on every start. */
  turnOn(): Promise<void>
  /** Takes it out, and keeps it out on every start. */
  turnOff(): Promise<void>
  copy(text: string): void
  /** Writes the menu again after a preset is turned on or off, so Finder shows it. */
  syncPresets?(): Promise<void>
}

/** Loaded on first use, so the shell's start-up loads none of the menu's code. */
export const realRightClick: RightClickSystem = {
  async isOn() {
    return (await import('../../menu/entry.js')).menuIsOn()
  },
  async turnOn() {
    await (await import('../../menu/entry.js')).switchMenu(true)
  },
  async turnOff() {
    await (await import('../../menu/entry.js')).switchMenu(false)
  },
  copy(text) {
    void import('../clipboard.js').then((c) => c.copy(text))
  },
  async syncPresets() {
    await (await import('../../menu/entry.js')).resyncMenu()
  },
}

/** The menu's gold, as the other settings: /right-click is reached from the menu. */
export function rightClickChip(p: Palette): BarChip {
  return { label: 'right-click', colour: p.brand, stops: modeGradient(p, 'menu') }
}

const COMMAND = 'forge uninstall'

/**
 * Decided (mockups/menu-settings-2026-10.html, S4) with the user's words:
 * whether Forge is in the right-click menu, with ↵ beside it to switch it,
 * then why `forge uninstall` is shown here, the command with `c` beside it.
 *
 * With presets saved (mockups/quick-actions-presets-2026-10-round4.html, P1
 * and U3): one row under the switch says how many are in the menu, and ↵ on
 * it opens a window of every preset to turn each on or off; Uninstalling
 * Forge is set apart by a rule down its left.
 */
function words(platform: NodeJS.Platform, on: boolean) {
  const mac = platform === 'darwin'
  return {
    state: mac
      ? on
        ? 'Forge is in Finder’s Quick Actions'
        : 'Forge is not in Finder’s Quick Actions'
      : on
        ? 'Forge is in the right-click menu'
        : 'Forge is not in the right-click menu',
    presetsTail: mac ? ' presets in Quick Actions' : ' presets in the right-click menu',
    windowTitle: mac ? 'Presets in Quick Actions' : 'Presets in the right-click menu',
    why: mac
      ? 'npm uninstall won’t remove Forge from your Mac’s Quick Actions. To remove it, run the command below to uninstall Forge and delete any remaining settings.'
      : 'npm uninstall won’t remove Forge from your PC’s right-click menu. To remove it, run the command below to uninstall Forge and delete any remaining settings.',
  }
}

/** `text` broken into lines of at most `max` columns, at spaces. */
function wrap(text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

export function RightClickFlow({
  width,
  platform = process.platform,
  system = realRightClick,
  presets: saved = [],
  onPresets,
  onClose,
}: {
  width: number
  platform?: NodeJS.Platform
  system?: RightClickSystem
  /** Every saved preset; each can be turned on as a Quick Action. */
  presets?: readonly Preset[]
  /** The presets with one turned on or off, to keep in the settings; the menu is synced once it settles. */
  onPresets?: (next: Preset[]) => void | Promise<void>
  onClose: () => void
}) {
  const palette = useTheme()
  const [on, setOn] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [presets, setPresets] = useState<Preset[]>(() => [...saved])
  /** Which row is lit: Forge's switch, or the presets' row (P1). */
  const [lit, setLit] = useState<'switch' | 'presets'>('switch')
  /** The presets' window, open, with the row in hand. */
  const [picking, setPicking] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    system
      .isOn()
      .then((v) => alive && setOn(v))
      .catch(() => alive && setOn(false))
    return () => {
      alive = false
    }
  }, [system])

  // The presets' row is only there with a preset saved, and only lit while Forge is in the menu.
  const listed = presets.length > 0
  const reachable = listed && on === true
  const here = reachable ? lit : 'switch'
  // Under the presets' window nothing is lit: the window is what is in hand.
  const shownLit = picking === null ? here : null

  const toggle = (at: number) => {
    const next = presets.map((p, i) => {
      if (i !== at) return p
      const { quickAction: _was, ...rest } = p
      return p.quickAction ? rest : { ...rest, quickAction: true as const }
    })
    setPresets(next)
    // The menu is written from the saved settings, so it waits for the save.
    void Promise.resolve(onPresets?.(next))
      .then(() => system.syncPresets?.())
      .catch(() => {})
  }

  useKeys((input, key) => {
    if (picking !== null) {
      if (key.escape) return setPicking(null)
      if (key.upArrow) return setPicking((at) => Math.max(0, (at ?? 0) - 1))
      if (key.downArrow) return setPicking((at) => Math.min(presets.length - 1, (at ?? 0) + 1))
      if (key.return) toggle(picking)
      return
    }
    if (key.escape) return onClose()
    if (busy || on === undefined) return
    if ((key.upArrow || key.downArrow) && reachable) {
      setLit(key.downArrow ? 'presets' : 'switch')
      return
    }
    if (key.return && here === 'presets') {
      setPicking(0)
      return
    }
    if (key.return) {
      setBusy(true)
      const next = !on
      void (next ? system.turnOn() : system.turnOff())
        .then(() => setOn(next))
        .catch(() => {})
        .finally(() => setBusy(false))
      return
    }
    if (input === 'c') system.copy(COMMAND)
  })

  const indent = blank(HOME_MARGIN + 2)
  const w = words(platform, on ?? false)
  const inMenu = presets.filter((p) => p.quickAction).length
  const count = `${inMenu} of ${presets.length}`
  // The lit row's ↵ sits at one column for both rows, so the two read as one list.
  const keyAt = HOME_MARGIN + 2 + Math.max(w.state.length, count.length + w.presetsTail.length) + 4
  const band = palette.panelBand || undefined
  /** A row of the list: lit, it has the band, ▌ in the menu's gold, and its ↵ at the end. */
  const listRow = (content: Run[], hint: Run[] | null): Row => {
    if (!listed || !hint) return [indent, ...content]
    const b = band ? { bg: band } : {}
    const row: Run[] = [
      blank(HOME_MARGIN),
      { text: '▌', fg: palette.brand, ...b },
      { text: ' ', ...b },
      ...content.map((r) => ({ ...r, ...b })),
    ]
    row.push({ text: ' '.repeat(Math.max(1, keyAt - runsWidth(row))), ...b })
    row.push(...hint.map((r) => (r.bg ? r : { ...r, ...b })))
    row.push({ text: ' '.repeat(Math.max(0, width - HOME_MARGIN - runsWidth(row))), ...b })
    return row
  }
  const status: Row =
    on === undefined
      ? [indent]
      : shownLit === 'switch' && listed
        ? listRow(
            [
              on ? { text: '● ', fg: palette.ok, bold: true } : { text: '○ ', fg: palette.border },
              { text: w.state, fg: on ? palette.fg : palette.dim, bold: on },
            ],
            keyHint(palette, '↵', on ? 'turn off' : 'turn on'),
          )
        : [
            indent,
            on ? { text: '● ', fg: palette.ok, bold: true } : { text: '○ ', fg: palette.border },
            { text: w.state, fg: on ? palette.fg : palette.dim, bold: on },
            ...(listed ? [] : [blank(4), ...keyHint(palette, '↵', on ? 'turn off' : 'turn on')]),
          ]
  const presetsRow: Row | null = !listed
    ? null
    : reachable && shownLit === 'presets'
      ? listRow(
          [
            { text: count, fg: palette.fg, bold: true },
            { text: w.presetsTail, fg: palette.dim },
          ],
          keyHint(palette, '↵', 'choose'),
        )
      : [
          indent,
          { text: count, fg: reachable ? palette.fg : palette.border, bold: reachable },
          { text: w.presetsTail, fg: reachable ? palette.dim : palette.border },
        ]

  // U3 (decided): Uninstalling Forge set apart by a rule down its left, no box.
  const rule: Run = { text: '▎', fg: palette.border }
  const textWidth = Math.max(20, width - (HOME_MARGIN + 2) * 2)
  const uninstall: Row[] = [
    [
      blank(HOME_MARGIN),
      rule,
      blank(1),
      { text: 'Uninstalling Forge', fg: palette.fg, bold: true },
    ],
    ...wrap(w.why, textWidth).map(
      (line): Row => [blank(HOME_MARGIN), rule, blank(1), { text: line, fg: palette.border }],
    ),
    [blank(HOME_MARGIN), rule, blank(1)],
    [
      blank(HOME_MARGIN),
      rule,
      { text: ` ${COMMAND} `, fg: palette.fg, bg: palette.selectionBg },
      blank(3),
      ...keyHint(palette, 'c', 'copy'),
    ],
  ]
  // A row with nothing in it has no height; a blank one keeps its place.
  const gap: Row = [blank(1)]
  const body: Row[] = [status, ...(presetsRow ? [gap, presetsRow] : []), gap, gap, ...uninstall]
  const shown =
    picking === null
      ? body
      : windowOver(palette, body, {
          title: w.windowTitle,
          lines: pickerLines(palette, presets, picking, Math.min(60, width - 4) - 2),
          width: Math.min(60, width - 4),
          columns: width,
          top: 0,
        })

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ScreenBar
        chip={rightClickChip(palette)}
        trail={{ answers: [], current: 'Right-click menu' }}
        width={width}
        drift={busy}
      />
      {shown.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <Runs key={i} row={row} />
      ))}
      <Box flexGrow={1} />
      <ScreenKeys
        width={width}
        pairs={
          picking !== null
            ? [
                ['↑↓', 'choose'],
                ['↵', presets[picking]?.quickAction ? 'turn off' : 'turn on'],
              ]
            : reachable
              ? [['↑↓', 'choose']]
              : []
        }
        foot={[['esc', picking !== null ? 'done' : 'back']]}
      />
    </Box>
  )
}

const runsWidth = (row: readonly Run[]) => row.reduce((n, r) => n + stringWidth(r.text), 0)

/**
 * The presets' window (P1): every preset, ● in the menu or ○ not, its steps
 * as the chain says them; the one in hand on the band with › in the gold.
 */
function pickerLines(p: Palette, presets: readonly Preset[], at: number, inner: number): Row[] {
  const nameW = Math.max(...presets.map((x) => x.name.length)) + 2
  return [
    [],
    ...presets.map((preset, i): Row => {
      const lit = i === at
      const b = lit && p.panelBand ? { bg: p.panelBand } : {}
      const row: Run[] = [
        { text: lit ? ' › ' : '   ', fg: p.brand, bold: true, ...b },
        preset.quickAction
          ? { text: '●', fg: p.ok, bold: true, ...b }
          : { text: '○', fg: p.border, ...b },
        { text: ' ', ...b },
        {
          text: preset.name.padEnd(nameW),
          fg: lit || preset.quickAction ? p.fg : p.dim,
          bold: lit || !!preset.quickAction,
          ...b,
        },
        ...chainLabels(undefined, preset.steps).flatMap((t, k): Run[] => [
          ...(k > 0 ? [{ text: ' ─▸ ', fg: p.faint, ...b }] : []),
          { text: t, fg: lit ? p.fg : p.border, ...b },
        ]),
      ]
      row.push({ text: ' '.repeat(Math.max(0, inner - runsWidth(row))), ...b })
      return row
    }),
    [],
  ]
}
