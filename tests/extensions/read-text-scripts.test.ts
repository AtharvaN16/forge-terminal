import { describe, expect, it } from 'vitest'
import { blocksOf, type OcrLine } from '../../extensions/read-text/layout.js'
import {
  drawnToLogical,
  type Models,
  type Recogniser,
  readCrops,
} from '../../extensions/read-text/runner.js'

/**
 * A recogniser that answers by the crop's width: `byWidth[w]` is the score it is
 * given for a crop that wide, and its text is its id. No model runs.
 */
function fake(
  id: string,
  byWidth: Record<number, number>,
  extra: Partial<Recogniser> = {},
): { rec: Recogniser; runs: () => number } {
  let runs = 0
  const session = {
    inputNames: ['x'],
    outputNames: ['y'],
    async run(feeds: Record<string, { dims: number[] }>) {
      runs++
      const w = (feeds.x as { dims: number[] }).dims[3] as number
      return { y: { dims: [1, 1, 4], data: Float32Array.from([0, byWidth[w] ?? 0, 0, 0]) } }
    },
  }
  return {
    rec: {
      id,
      chars: ['', id, '?', ' '],
      reverse: false,
      file: `${id}.onnx`,
      session: session as never,
      ...extra,
    },
    runs: () => runs,
  }
}

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array,
    readonly dims: number[],
  ) {}
}

const models = (recs: Recogniser[]) =>
  ({ recs, Tensor: FakeTensor, create: async () => undefined, det: undefined }) as unknown as Models

/** Crops of widths 100, 101, … so each line is told apart. */
const crops = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ data: new Float32Array(1), w: 100 + i }))
const widths = (n: number, score: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [100 + i, score]))

describe('which recogniser reads a page', () => {
  it('leaves a page to the main recogniser when it is sure, and never runs the others', async () => {
    const main = fake('main', widths(10, 0.99))
    const korean = fake('korean', widths(10, 0.99))
    const out = await readCrops(models([main.rec, korean.rec]), crops(10))
    expect(out.every((r) => r?.id === 'main')).toBe(true)
    expect(korean.runs()).toBe(0)
  })

  it('gives the page to the recogniser that is surest on its widest lines when the main one is not', async () => {
    const main = fake('main', widths(10, 0.2))
    const korean = fake('korean', widths(10, 0.97))
    const thai = fake('thai', widths(10, 0.4))
    const out = await readCrops(models([main.rec, korean.rec, thai.rec]), crops(10))
    expect(out.map((r) => r?.id)).toEqual(Array(10).fill('korean'))
  })

  it('asks the lookalike script even when the main recogniser is sure, and takes it when surer', async () => {
    // A Latin recogniser reads Cyrillic in lookalikes at 0.97: Cyrillic reads it at 0.99.
    const main = fake('main', widths(10, 0.97))
    const cyrillic = fake('cyrillic', widths(10, 0.995), { probe: true })
    const korean = fake('korean', widths(10, 0.1))
    const out = await readCrops(models([main.rec, cyrillic.rec, korean.rec]), crops(10))
    expect(out.map((r) => r?.id)).toEqual(Array(10).fill('cyrillic'))
    expect(korean.runs()).toBe(0)
  })

  it('does not move a Latin page to the lookalike script on a tie', async () => {
    const main = fake('main', widths(10, 0.99))
    const cyrillic = fake('cyrillic', widths(10, 0.99), { probe: true })
    const out = await readCrops(models([main.rec, cyrillic.rec]), crops(10))
    expect(out.every((r) => r?.id === 'main')).toBe(true)
  })

  it('keeps the main reading of a line in its own script on a page of another', async () => {
    // Line 105 is English on a Korean page: korean is unsure of it, main is sure.
    const main = fake('main', { ...widths(10, 0.1), 105: 0.98 })
    const korean = fake('korean', { ...widths(10, 0.97), 105: 0.3 })
    const out = await readCrops(models([main.rec, korean.rec]), crops(10))
    expect(out[5]?.id).toBe('main')
    expect(out[4]?.id).toBe('korean')
  })

  it("does not let a lookalike reading win a line the page's recogniser could have written", async () => {
    // A Cyrillic page, which the Cyrillic recogniser takes (0.99 against the main one's 0.9).
    // Line 5: main reads it in lookalikes, surer (0.97 against 0.9), with a letter Cyrillic
    // has too: Cyrillic keeps the line. Line 6: main's reading has a Greek letter Cyrillic has
    // no letter for, and is surer: main takes it.
    const scores = { ...widths(10, 0.9), 105: 0.97, 106: 0.97 }
    const main = fake('main', scores, { chars: ['', 'a', '?', ' '] })
    const greek = fake('main', scores, { chars: ['', 'φ', '?', ' '] })
    const cyrillic = fake('cyrillic', { ...widths(10, 0.99), 105: 0.9, 106: 0.9 }, { probe: true })
    cyrillic.rec.chars = ['', 'a', '?', ' ']
    const lookalike = await readCrops(models([main.rec, cyrillic.rec]), crops(10))
    expect(lookalike[4]?.id).toBe('cyrillic')
    expect(lookalike[5]?.id).toBe('cyrillic')
    const withGreek = await readCrops(models([greek.rec, cyrillic.rec]), crops(10))
    expect(withGreek[4]?.id).toBe('cyrillic')
    expect(withGreek[6]?.id).toBe('main')
  })

  it('offers a line nobody was sure of to every recogniser', async () => {
    // A Latin page with one line of Thai: main 0.4, and thai 0.95.
    const main = fake('main', { ...widths(10, 0.99), 103: 0.4 })
    const thai = fake('thai', { ...widths(10, 0.1), 103: 0.95 })
    const out = await readCrops(models([main.rec, thai.rec]), crops(10))
    expect(out[3]?.id).toBe('thai')
    expect(out[2]?.id).toBe('main')
  })

  it('reads a page with only one recogniser, and one with no lines', async () => {
    const main = fake('main', widths(3, 0.8))
    expect((await readCrops(models([main.rec]), crops(3))).map((r) => r?.id)).toEqual([
      'main',
      'main',
      'main',
    ])
    expect(await readCrops(models([main.rec]), [])).toEqual([])
  })
})

describe('Arabic as the model draws it', () => {
  it('reads right to left, a run of Latin letters or digits staying whole', () => {
    expect(drawnToLogical('ملس')).toBe('سلم')
    expect(drawnToLogical('ملس12')).toBe('12سلم')
    expect(drawnToLogical('abc')).toBe('abc')
  })
})

const line = (text: string, x: number, y: number, w: number, h = 30): OcrLine => ({
  text,
  box: [x, y, w, h],
})
const PAGE = { width: 1000, height: 1400 }

describe('layout for scripts without spaces between words', () => {
  it('joins Chinese and Japanese lines with no space, and Thai too', () => {
    const blocks = blocksOf(
      [
        line('地球是太阳系中由内向外的第三颗行', 100, 100, 700),
        line('星，与太阳平均距离很远。', 100, 140, 400),
      ],
      PAGE,
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'text',
      text: '地球是太阳系中由内向外的第三颗行星，与太阳平均距离很远。',
    })
    const thai = blocksOf(
      [
        line('โลก มีความหมายโดยปริยายหมายถึงหมู่', 100, 100, 700),
        line('มนุษย์ รวมทั้งอาณาเขต', 100, 140, 400),
      ],
      PAGE,
    )
    expect(thai[0]).toMatchObject({ text: 'โลก มีความหมายโดยปริยายหมายถึงหมู่มนุษย์ รวมทั้งอาณาเขต' })
  })

  it('keeps ideograph lines a full line height apart in one paragraph, and breaks at a wider gap', () => {
    const body = (y: number, text: string) => line(text, 100, y, 800, 29)
    const blocks = blocksOf(
      [
        body(100, '地球是太阳系中由内向外的第三颗行星，与太阳平均距离'),
        body(153, '一亿五千万公里，位于太阳系宜居带正中位置。'),
        body(206, '地球质量约为五点九七乘以十的二十四次方公斤，平均'),
        // A paragraph break: nearly twice the leading.
        body(305, '地球形成于约四十五亿年前，在形成后不久曾遭到撞击。'),
      ],
      PAGE,
    )
    expect(blocks.map((b) => b.kind === 'text' && b.lines)).toEqual([3, 1])
  })

  it('still puts a space between Korean, Arabic, Hindi and Latin lines', () => {
    const blocks = blocksOf(
      [
        line('지구는 태양으로부터 세 번째', 100, 100, 700),
        line('행성이며 조금 두꺼운', 100, 140, 500),
      ],
      PAGE,
    )
    expect(blocks[0]).toMatchObject({ text: '지구는 태양으로부터 세 번째 행성이며 조금 두꺼운' })
  })

  it('mends a hyphenated Cyrillic word as it does a Latin one', () => {
    const blocks = blocksOf(
      [line('Это очень длин-', 100, 100, 700), line('ный пример текста', 100, 140, 500)],
      PAGE,
    )
    expect(blocks[0]).toMatchObject({ text: 'Это очень длинный пример текста' })
  })

  it('does not take two columns of Chinese prose for a table', () => {
    const rows = [0, 1, 2, 3].flatMap((k) => [
      line('地球是太阳系中由内向外的第三颗行星', 100, 100 + k * 40, 380),
      line('与太阳平均距离一亿五千万公里远', 520, 100 + k * 40, 380),
    ])
    const blocks = blocksOf(rows, PAGE)
    expect(blocks.some((b) => b.kind === 'table')).toBe(false)
  })

  it('still reads aligned short Chinese cells as a table', () => {
    const rows = [0, 1, 2].flatMap((k) => [
      line('合计', 100, 100 + k * 40, 120),
      line('1,234', 400, 100 + k * 40, 120),
    ])
    expect(blocksOf(rows, PAGE).some((b) => b.kind === 'table')).toBe(true)
  })

  it('reads a Japanese dot-and-shape bullet as a list item, with or without a space', () => {
    const blocks = blocksOf(
      [line('・水の確保が進んだ', 120, 100, 500), line('・診療所が二つ閉まった', 120, 140, 500)],
      PAGE,
    )
    expect(blocks[0]).toMatchObject({
      kind: 'list',
      items: [
        { marker: 'bullet', text: '水の確保が進んだ' },
        { marker: 'bullet', text: '診療所が二つ閉まった' },
      ],
    })
  })
})

describe('the dictionaries in PaddleOCR config files', () => {
  it('reads plain characters, quoted ones, a doubled quote and a multi-part emoji, in order', async () => {
    const build = '../../extensions/read-text/build.mjs'
    const { characterDict } = (await import(/* @vite-ignore */ build)) as {
      characterDict: (yml: string) => string[]
    }
    const yml = [
      'PostProcess:',
      '  name: CTCLabelDecode',
      '  character_dict:',
      "  - '!'",
      '  - $',
      "  - ''''",
      '  - 字',
      '  - 🇩🇪',
      "  - ' '",
      'Global:',
      '  - not a character',
    ].join('\n')
    expect(characterDict(yml)).toEqual(['!', '$', "'", '字', '🇩🇪', ' '])
    expect(() => characterDict('PostProcess: {}')).toThrow(/no character_dict/)
  })
})
