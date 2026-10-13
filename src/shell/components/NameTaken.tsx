import { Box, type DOMElement } from 'ink'
import { type ReactNode, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { formatBytes } from '../../core/units.js'
import { describeAge } from '../age.js'
import { useClickTarget } from '../ClickTargets.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeColours, type ShellMode, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { CARD_WIDTH, middleEllipsis } from '../width.js'
import { HintBar } from './HintBar.js'
import { StepTitle } from './StepTitle.js'

export type NameTakenChoice = 'keep' | 'replace' | 'cancel'

const CHOICES: Array<[NameTakenChoice, string]> = [
  ['keep', 'Keep both'],
  ['replace', 'Replace'],
  ['cancel', 'Cancel'],
]
/** The names' column, as the decided list pads it. */
const NAME_COLUMN = 12
/** The title row's width from its lead, as `titleRow` draws it. */
const TITLE_WIDTH = 64

/**
 * Name taken (L1, mockups/flow-parts-2-2026-10.html "Name taken ✓"): the
 * question after Save as when the folder already has a file by that name.
 * Keep both, Replace, Cancel, on the picker's band; Keep both first, so ↵
 * does the safe thing. Only the highlighted row speaks, and what it says is
 * a preview of the answer: the name yours gets, the one there now crossed
 * out and the band hatched after it, or where Cancel goes.
 */
export function NameTaken({
  mode,
  width,
  name,
  keepBoth,
  existing,
  now,
  onSubmit,
  onCancel,
}: {
  mode: ShellMode
  width: number
  /** The name that is taken — or how many, "3 files", when several are. */
  name: string
  /** What Keep both saves yours as: "test (1).jpg". */
  keepBoth: string
  /** The one there now, from one `stat`: its size and age go at the title's right. */
  existing?: { bytes: number; modified: Date } | undefined
  /** The clock the age is told against; the real one unless a test fixes it. */
  now?: Date
  onSubmit: (choice: NameTakenChoice) => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const choose = (i: number) => {
    indexRef.current = i
    setIndex(i)
  }
  useKeys((_input, key) => {
    if (key.downArrow) choose(Math.min(CHOICES.length - 1, indexRef.current + 1))
    if (key.upArrow) choose(Math.max(0, indexRef.current - 1))
    if (key.return) onSubmit(CHOICES[indexRef.current]?.[0] ?? 'cancel')
    if (key.escape) onCancel()
  })

  const several = existing === undefined && /^\d+ files$/.test(name)
  const verb = several ? ' already exist' : ' already exists'
  // The name gives way, from its middle, before the words that say what is
  // wrong do: the title is one row and is cut at its end otherwise.
  const titleRoom = Math.min(width, 1 + TITLE_WIDTH) - 1 - verb.length
  const title = `${middleEllipsis(name, Math.max(4, titleRoom))}${verb}`
  const aside = existing
    ? `${formatBytes(existing.bytes)} · ${describeAge(existing.modified, now)}`
    : undefined
  const bandWidth = Math.min(width, CARD_WIDTH)
  const noColour = (process.env.NO_COLOR ?? '') !== ''
  const band = noColour || palette.listBand === '' ? undefined : palette.listBand
  const accent = modeColours(palette, mode).fg

  /** What the highlighted answer does, in `room` cells. */
  const preview = (choice: NameTakenChoice, room: number): ReactNode => {
    if (choice === 'keep') {
      // The (1) is the part that is new: bold, in the mode's colour.
      const at = keepBoth.lastIndexOf(' (')
      const close = keepBoth.indexOf(')', at)
      const lead = 'saves yours as '
      if (at <= 0 || close === -1) {
        return (
          <Text color={colourProp(palette.dim)}>
            {lead}
            <Text color={colourProp(palette.fg)}>
              {middleEllipsis(keepBoth, Math.max(4, room - lead.length))}
            </Text>
          </Text>
        )
      }
      // Only the name before the (1) gives way: the (1) and the extension
      // say what Keep both does, so they always show.
      const mark = keepBoth.slice(at, close + 1)
      const tail = keepBoth.slice(close + 1)
      const stem = middleEllipsis(
        keepBoth.slice(0, at),
        Math.max(1, room - lead.length - stringWidth(mark) - stringWidth(tail)),
      )
      return (
        <Text color={colourProp(palette.dim)}>
          {lead}
          <Text color={colourProp(palette.fg)}>{stem}</Text>
          <Text bold color={colourProp(accent)}>
            {mark}
          </Text>
          <Text color={colourProp(palette.fg)}>{tail}</Text>
        </Text>
      )
    }
    if (choice === 'replace') {
      // What Replace loses: the one there now, struck through, then the rest
      // of the band hatched, as Done hatches what a file shed.
      const lost = middleEllipsis(
        existing ? `${name}  ${formatBytes(existing.bytes)}` : name,
        Math.max(4, room - 3),
      )
      const hatch = Math.max(0, room - stringWidth(lost) - 2)
      return (
        <Text>
          <Text strikethrough color={colourProp(palette.border)}>
            {lost}
          </Text>
          <Text color={colourProp(palette.faint)}>{` ${'╱'.repeat(hatch)}`}</Text>
        </Text>
      )
    }
    return <Text color={colourProp(palette.dim)}>back to Save as</Text>
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <StepTitle mode={mode} title={title} aside={aside} width={width} />
      </Box>
      {CHOICES.map(([choice, label], i) => {
        const selected = i === index
        const room = bandWidth - 2 - NAME_COLUMN - 1
        return (
          <ChoiceRow
            key={choice}
            id={`name-taken-${choice}`}
            onClick={() => onSubmit(choice)}
            onHover={() => choose(i)}
          >
            <Box width={bandWidth} {...(selected && band ? { backgroundColor: band } : {})}>
              <Text color={colourProp(accent)}>{selected ? `${SYMBOLS.strip} ` : '  '}</Text>
              <Text bold={selected} color={colourProp(selected ? palette.fg : palette.dim)}>
                {label.padEnd(NAME_COLUMN)}
              </Text>
              {selected ? preview(choice, room) : null}
            </Box>
          </ChoiceRow>
        )
      })}
      <HintBar
        width={width}
        pairs={[
          ['↑↓', 'choose'],
          ['↵', 'confirm'],
        ]}
        foot={[['esc', 'cancel']]}
      />
    </Box>
  )
}

/** One answer's row and the click region it occupies. */
function ChoiceRow({
  id,
  onClick,
  onHover,
  children,
}: {
  id: string
  onClick: () => void
  onHover: () => void
  children: ReactNode
}) {
  const ref = useRef<DOMElement | null>(null)
  useClickTarget({
    id,
    ref,
    onClick,
    onHover: (hovering) => {
      if (hovering) onHover()
    },
  })
  return <Box ref={ref}>{children}</Box>
}
