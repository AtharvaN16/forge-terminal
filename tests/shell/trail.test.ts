import { describe, expect, it } from 'vitest'
import { answerFor, pdfTrail, trailFor } from '../../src/shell/trail.js'

const convert = { target: 'JPEG', quality: '80', destination: 'Desktop', name: 'test.jpg' }

describe('trailFor', () => {
  it('walks convert as the mockup does: answers so far, then the question', () => {
    const at = (step: Parameters<typeof trailFor>[0]['step']) =>
      trailFor({ mode: 'convert', step, answers: convert })
    expect(at('target')).toEqual({ answers: [], current: 'Format' })
    expect(at('quality')).toEqual({ answers: ['JPEG'], current: 'Quality' })
    expect(at('destination')).toEqual({ answers: ['JPEG', '80'], current: 'Save to' })
    expect(at('rename')).toEqual({ answers: ['JPEG', '80', 'Desktop'], current: 'Name' })
  })

  it('walks compress: Method first', () => {
    const answers = { mode: 'By quality', quality: '70', destination: 'Desktop' }
    expect(trailFor({ mode: 'compress', step: 'mode', answers })).toEqual({
      answers: [],
      current: 'Method',
    })
    expect(trailFor({ mode: 'compress', step: 'quality', answers })).toEqual({
      answers: ['By quality'],
      current: 'Quality',
    })
  })

  it('names the screens the mockup does not draw', () => {
    const answers = { target: 'JPEG', pages: 'All pages', dpi: '150 dpi' }
    expect(trailFor({ mode: 'convert', step: 'pages', answers }).current).toBe('Pages')
    expect(trailFor({ mode: 'convert', step: 'page-picker', answers }).current).toBe('Pages')
    expect(trailFor({ mode: 'convert', step: 'dpi', answers })).toEqual({
      answers: ['JPEG', 'All pages'],
      current: 'Resolution',
    })
    expect(trailFor({ mode: 'compress', step: 'size', answers: { mode: 'To a size' } })).toEqual({
      answers: ['To a size'],
      current: 'Size',
    })
    expect(trailFor({ mode: 'convert', step: 'overwrite', answers: convert }).current).toBe(
      'Overwrite',
    )
  })

  it('ends with the verb while working, and with Done after every answer', () => {
    expect(trailFor({ mode: 'convert', step: 'converting', answers: convert })).toEqual({
      answers: ['JPEG', '80', 'Desktop', 'test.jpg'],
      current: 'Converting',
    })
    expect(trailFor({ mode: 'compress', step: 'converting', answers: {} }).current).toBe(
      'Compressing',
    )
    expect(trailFor({ mode: 'convert', step: 'result', answers: convert })).toEqual({
      answers: ['JPEG', '80', 'Desktop', 'test.jpg'],
      current: 'Done',
    })
  })

  it('never shows an answer from a step still ahead, even one already given', () => {
    // Back at Format after reaching Quality: the slider's value is still held.
    expect(trailFor({ mode: 'convert', step: 'target', answers: convert }).answers).toEqual([])
  })

  it('names the waiting file, and asks nothing, at the field', () => {
    expect(trailFor({ mode: 'convert', step: 'idle', answers: {}, waiting: 'test.png' })).toEqual({
      answers: ['test.png'],
      current: undefined,
    })
  })
})

describe('answerFor: an answer as the user would say it', () => {
  const select = {
    kind: 'select' as const,
    id: 'mode',
    label: 'How',
    default: 'every-page',
    choices: [
      { value: 'every-page', label: 'Every page' },
      { value: 'points', label: 'At points I choose' },
    ],
  }
  const text = { kind: 'text' as const, id: 'pages', label: 'Pages', placeholder: '' }

  it('says a choice by its label', () => {
    expect(answerFor(select, 'points')).toBe('At points I choose')
  })

  it('says pages as 1-based ranges', () => {
    expect(answerFor(text, [0, 1, 2, 6])).toBe('1-3, 7')
  })

  it('says nothing for a question not answered', () => {
    expect(answerFor(select, undefined)).toBeUndefined()
  })
})

describe('pdfTrail', () => {
  const split = {
    id: 'split',
    label: 'Split',
    hint: '',
    appliesTo: () => true,
    options: () => [],
    plan: () => [],
  }
  const pages = { kind: 'text' as const, id: 'pages', label: 'Pages', placeholder: '' }
  const output = {
    kind: 'select' as const,
    id: 'separate',
    label: 'Output',
    default: 'one',
    choices: [{ value: 'one', label: 'One file' }],
  }
  const extract = { ...split, id: 'extract', label: 'Extract' }

  it('asks for the action first', () => {
    expect(pdfTrail({ step: 'hub', specs: [], specIndex: 0, values: {} })).toEqual({
      answers: [],
      current: 'Action',
    })
  })

  it('names each option by its label, after the action and the options before it', () => {
    const at = (specIndex: number) =>
      pdfTrail({
        step: 'options',
        action: extract,
        specs: [pages, output],
        specIndex,
        values: { pages: [0, 1, 2, 6] },
      })
    expect(at(0)).toEqual({ answers: ['Extract'], current: 'Pages' })
    expect(at(1)).toEqual({ answers: ['Extract', '1-3, 7'], current: 'Output' })
  })

  it('confirms after every answer', () => {
    expect(
      pdfTrail({
        step: 'confirm',
        action: extract,
        specs: [pages, output],
        specIndex: 1,
        values: { pages: [0], separate: 'one' },
      }),
    ).toEqual({ answers: ['Extract', '1', 'One file'], current: 'Confirm' })
  })

  it('names the screens of its own that split and merge have', () => {
    expect(
      pdfTrail({ step: 'split-n', action: split, specs: [], specIndex: 0, values: {} }).current,
    ).toBe('Pages each')
    expect(
      pdfTrail({ step: 'split-grid', action: split, specs: [], specIndex: 0, values: {} }).current,
    ).toBe('Cuts')
    expect(
      pdfTrail({
        step: 'merge',
        action: { ...split, id: 'merge', label: 'Merge' },
        specs: [],
        specIndex: 0,
        values: {},
      }),
    ).toEqual({ answers: ['Merge'], current: 'Order' })
  })
})
