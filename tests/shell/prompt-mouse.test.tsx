import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

function mount(
  value: string,
  opts: { isActive?: boolean; variant?: 'drop' | 'field' | 'plain'; width?: number } = {},
) {
  const onChange = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  function Harness() {
    registry = useClickTargetRegistry()
    return (
      <Prompt
        value={value}
        onChange={onChange}
        onSubmit={vi.fn()}
        placeholder="drop a file"
        isActive={opts.isActive ?? true}
        variant={opts.variant ?? 'plain'}
        width={opts.width ?? 40}
      />
    )
  }
  const app = render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Harness />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
  return {
    app,
    onChange,
    get registry() {
      return registry
    },
  }
}

describe('Prompt click-to-position', () => {
  it('registers a target covering the text', () => {
    const h = mount('hello.png')
    expect(h.registry.size()).toBeGreaterThan(0)
    h.app.unmount()
  })

  it('moves the caret to the clicked character', () => {
    const h = mount('hello.png')
    // Column 5 is the '.', counting from the first character of the text.
    h.registry.hitTest({ row: 0, col: 5 })?.onClick({ row: 0, col: 5 })
    // Assert by effect, the way prompt-selection.test.tsx does: type, and see
    // where the character landed. Far more robust than matching the caret's
    // inverse-video run, which renders differently under NO_COLOR.
    h.app.stdin.write('X')
    expect(h.onChange).toHaveBeenLastCalledWith('helloX.png')
    h.app.unmount()
  })

  it('clamps a click past the end of the text to the end', () => {
    const h = mount('ab')
    h.registry.hitTest({ row: 0, col: 30 })?.onClick({ row: 0, col: 30 })
    h.app.stdin.write('X')
    // `offsetForColumn` returns the character count for any column past the
    // text, so the caret lands after 'b' — never beyond the buffer.
    expect(h.onChange).toHaveBeenLastCalledWith('abX')
    h.app.unmount()
  })

  it('leaves the caret alone when the prompt is inactive', () => {
    const h = mount('hello.png', { isActive: false })
    // An inactive prompt registers nothing, so a click cannot reach it — the
    // same rule its `useKeys({ isActive })` gate already applies to keys.
    expect(h.registry.hitTest({ row: 0, col: 5 })).toBeNull()
    h.app.unmount()
  })

  /**
   * A value longer than the available width spans several visual rows —
   * the normal case for a real path, not an edge case — because it renders
   * inside `<Text wrap="wrap">`. These fixtures are all hand-verified
   * against wrap-ansi@10 (what Ink 7.1.1's `wrap-text.js` calls with
   * `{ trim: false, hard: true }`) rather than assumed: a 58-character,
   * space-free path at a plain-variant width of 30 (marker `'  › '`, 4
   * cells) wraps into exactly three rows —
   *
   *   row 0: "  › "                          (marker only — the whole path
   *                                            doesn't fit the 26 cells left
   *                                            after the marker, so it moves
   *                                            whole to row 1, the same way
   *                                            wrap-ansi moves a single
   *                                            oversized word)
   *   row 1: "/Users/someone/Developer/reall" (chars 0..30 of the value)
   *   row 2: "y-long-project-name/file.png"   (chars 30..58)
   */
  describe('wrapped values', () => {
    const wrappedPath = '/Users/someone/Developer/really-long-project-name/file.png'

    it('still maps row 0 exactly as before, even when the value wraps', () => {
      const h = mount(wrappedPath, { width: 30 })
      // Column 5 past the marker is still squarely inside row 0's own text
      // ("  › " occupies columns 0..3), so this exercises nothing new — the
      // row-0 branch is untouched by the continuation-row fix below.
      h.registry.hitTest({ row: 0, col: 5 })?.onClick({ row: 0, col: 5 })
      h.app.stdin.write('X')
      expect(h.onChange).toHaveBeenLastCalledWith(
        '/UserXs/someone/Developer/really-long-project-name/file.png',
      )
      h.app.unmount()
    })

    it('maps a click on a continuation row to the character actually under it', () => {
      const h = mount(wrappedPath, { width: 30 })
      // Row 2, target-relative column 15 -> on-screen column 19 once the
      // marker inset (4) is added back for a row with no marker -> index 19
      // into row 2's own slice ("y-long-project-name/file.png") -> global
      // index 30 + 19 = 49, which sits right before "/file.png".
      h.registry.hitTest({ row: 2, col: 15 })?.onClick({ row: 2, col: 15 })
      h.app.stdin.write('X')
      expect(h.onChange).toHaveBeenLastCalledWith(
        '/Users/someone/Developer/really-long-project-nameX/file.png',
      )
      h.app.unmount()
    })

    // This test fails against the pre-fix code: the old handler used
    // `point.col` (15) directly as a column into the whole value, ignoring
    // `point.row` entirely, and landed on index 15 ('/' before "Developer")
    // instead of index 49 — reproducing exactly the reviewer's repro
    // (clicking a continuation row types into visual line 0).

    it('maps a click on the LAST continuation row the same way', () => {
      // Same value and width; row 1 covers value[0:30], so this exercises a
      // different row than the row-2 case above.
      const h = mount(wrappedPath, { width: 30 })
      // point.col 10 -> on-screen column 14 -> index 14 into row 1's slice,
      // which starts at global index 0 -> global index 14.
      h.registry.hitTest({ row: 1, col: 10 })?.onClick({ row: 1, col: 10 })
      h.app.stdin.write('X')
      expect(h.onChange).toHaveBeenLastCalledWith(
        '/Users/someoneX/Developer/really-long-project-name/file.png',
      )
      h.app.unmount()
    })

    it('lands in the same place from the filled variant, whose marker is 2 cells not 4', () => {
      // width 32 with the filled variant's paddingX: 1 gives the same
      // 30-cell wrap width as the plain-variant case above, so this and the
      // continuation-row test converge on the same target character (index
      // 49, right before "/file.png") despite wrapping into only two rows
      // here (marker width 2 leaves room to pack 28 characters after it on
      // row 0, so nothing is pushed to a marker-only row).
      const h = mount(wrappedPath, { variant: 'field', width: 32 })
      // `hitTest` and `onClick` take points in different spaces: `hitTest`
      // wants the frame-absolute row, and the filled variant's Box sits 3
      // rows into the frame (marginTop 2 + paddingY 1) — `onClick`'s `point`
      // is already target-relative, which is the row-1-means-row-1 space
      // every other assertion in this file uses.
      h.registry.hitTest({ row: 4, col: 19 })?.onClick({ row: 1, col: 19 })
      h.app.stdin.write('X')
      expect(h.onChange).toHaveBeenLastCalledWith(
        '/Users/someone/Developer/really-long-project-nameX/file.png',
      )
      h.app.unmount()
    })

    it('shifts by exactly the marker-width difference between plain and filled', () => {
      // A value chosen so BOTH variants push it whole to row 1 (marker-only
      // row 0) at columns=30 — verified against wrap-ansi@10 — so row 1 is
      // value[0:30] for both, and the two variants differ ONLY in
      // markerWidth (4 vs 2). The same target-relative point.col (10) then
      // lands 2 characters apart, which is exactly the marker-width gap.
      const value = '/Users/someone/Projects/forge-cli/really-long-source-file-na'

      const plain = mount(value, { variant: 'plain', width: 30 })
      plain.registry.hitTest({ row: 1, col: 10 })?.onClick({ row: 1, col: 10 })
      plain.app.stdin.write('X')
      expect(plain.onChange).toHaveBeenLastCalledWith(
        '/Users/someoneX/Projects/forge-cli/really-long-source-file-na',
      )
      plain.app.unmount()

      const filled = mount(value, { variant: 'field', width: 32 })
      // See the comment in the previous test: `hitTest` needs the
      // frame-absolute row (the filled variant's Box starts 3 rows in).
      filled.registry.hitTest({ row: 4, col: 10 })?.onClick({ row: 1, col: 10 })
      filled.app.stdin.write('X')
      expect(filled.onChange).toHaveBeenLastCalledWith(
        '/Users/someoXne/Projects/forge-cli/really-long-source-file-na',
      )
      filled.app.unmount()
    })

    it('falls back to the end of the value on a continuation row when the value contains a space', () => {
      // wrap-ansi wraps a spaced value at word boundaries rather than fixed
      // columns (see the comment on `hardWrapBounds` in Prompt.tsx), which
      // this component does not attempt to reproduce — a continuation-row
      // click lands at the end instead of guessing a wrong offset.
      const spaced = '/Users/someone/My Documents/annual report final version.pdf'
      const h = mount(spaced, { width: 30 })
      h.registry.hitTest({ row: 1, col: 5 })?.onClick({ row: 1, col: 5 })
      h.app.stdin.write('X')
      expect(h.onChange).toHaveBeenLastCalledWith(`${spaced}X`)
      h.app.unmount()
    })
  })
})
