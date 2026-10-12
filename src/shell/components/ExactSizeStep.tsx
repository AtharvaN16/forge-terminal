import { Box } from 'ink'
import { useReducer, useRef } from 'react'
import { resizedSize, type Size } from '../../core/resize.js'
import type { ResizeSpec } from '../../core/types.js'
import { exactFromHeight, exactFromWidth, exactPairRows, overLimit } from '../resize-art.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { StepTitle } from './StepTitle.js'

type Side = 'width' | 'height'

interface Pair {
  width: string
  height: string
  focus: Side
  /** The side typed in, the other worked out from it; undefined until a digit is typed. */
  typed: Side | undefined
  /** The focused box's number is selected: the next digit replaces it. */
  fresh: boolean
}

/** Six digits is past every limit; more is a key held down. */
const MOST_DIGITS = 6

/**
 * `#` from Resize's slider (R4, mockups/resize-2026-10.html X): W and H,
 * holding the slider's size. Typing over one makes the other follow (dim:
 * Forge worked it out); the shape is always kept. tab moves between them,
 * esc goes back to the slider, ↵ confirms. Only digits; empty, 0 or over the
 * limits cannot be confirmed — the last says why.
 */
export function ExactSizeStep({
  mode,
  aside,
  from,
  percent,
  onSubmit,
  onCancel,
  width,
}: {
  mode: ShellMode
  aside: string
  /** The upright size the pair keeps the shape of. */
  from: Size
  /** The slider's percent: the pair starts at its size, and ↵ untouched keeps it. */
  percent: number
  onSubmit: (spec: ResizeSpec) => void
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  const start = resizedSize(from, { percent })
  // A ref, as Slider and Prompt keep one: keys typed in one burst each see
  // the last one's result before React has drawn it.
  const pair = useRef<Pair>({
    width: String(start.width),
    height: String(start.height),
    focus: 'width',
    typed: undefined,
    fresh: true,
  })
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  const set = (next: Pair) => {
    pair.current = next
    redraw()
  }
  /** `value` typed into `side`: the other side follows, or empties with it. */
  const typedInto = (p: Pair, side: Side, value: string): Pair => {
    const n = Number(value)
    const other =
      n > 0
        ? side === 'width'
          ? String(exactFromWidth(from, n).height)
          : String(exactFromHeight(from, n).width)
        : ''
    return side === 'width'
      ? { ...p, width: value, height: other, typed: 'width', fresh: false }
      : { ...p, height: value, width: other, typed: 'height', fresh: false }
  }
  const asked = (p: Pair): { spec: ResizeSpec; size: Size } | undefined => {
    if (p.typed === undefined) return { spec: { percent }, size: start }
    const n = Number(p[p.typed])
    if (!(n > 0)) return undefined
    const spec: ResizeSpec = p.typed === 'width' ? { width: n } : { height: n }
    return { spec, size: resizedSize(from, spec) }
  }

  useKeys((input, key) => {
    const p = pair.current
    if (key.escape) return onCancel()
    if (key.tab) return set({ ...p, focus: p.focus === 'width' ? 'height' : 'width', fresh: true })
    if (key.return) {
      const a = asked(p)
      if (a && !overLimit(a.size)) onSubmit(a.spec)
      return
    }
    const side = p.focus
    if (key.backspace || key.delete) {
      return set(typedInto(p, side, p.fresh ? '' : p[side].slice(0, -1)))
    }
    if (/^\d+$/.test(input)) {
      const value = (p.fresh ? input : p[side] + input).replace(/^0+(?=\d)/, '')
      if (value.length <= MOST_DIGITS) set(typedInto(p, side, value))
    }
  })

  const p = pair.current
  const a = asked(p)
  const refusal = a ? overLimit(a.size) : undefined
  return (
    <Box flexDirection="column" marginBottom={1}>
      <StepTitle mode={mode} title="Exact size" aside={aside} width={width} />
      <Box marginTop={1} flexDirection="column">
        {exactPairRows({
          palette,
          mode,
          width: p.width,
          height: p.height,
          focus: p.focus,
          follows: p.typed !== undefined && p.typed === p.focus,
          refusal,
        }).map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Runs key={i} row={row} />
        ))}
      </Box>
      <HintBar
        width={width}
        pairs={[
          ['↵', 'confirm'],
          ['tab', 'width / height'],
        ]}
        foot={[
          ['esc', 'slider'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}
