import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo } from '../../src/core/types.js'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const frameOf = (node: ReactElement) =>
  render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>).lastFrame() ?? ''

const doc = (over: Partial<DocumentInfo> = {}): DocumentInfo => ({
  kind: 'document',
  path: '/Users/me/report.pdf',
  format: 'pdf',
  bytes: 45_000,
  pages: 3,
  encrypted: false,
  ...over,
})

describe('FileCard page count', () => {
  it('shows the page count for a document with a known one', () => {
    const frame = frameOf(<FileCard source={doc({ pages: 3 })} width={100} />)
    expect(frame).toContain('3 pages')
  })

  it('omits the page count entirely for an unknown one, rather than showing "0 pages"', () => {
    const frame = frameOf(
      <FileCard
        source={doc({ path: '/Users/me/legacy.doc', format: 'doc', pages: 0 })}
        width={100}
      />,
    )
    expect(frame).not.toContain('0 pages')
    expect(frame).not.toContain('pages')
  })
})
