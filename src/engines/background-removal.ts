import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MODEL = 'Ko033/isnet-general-use-onnx'
// Pinned so an upstream model update cannot silently change local results.
const MODEL_REVISION = '5349b617911fd60c619b52f32e2b593517b78df3'

export interface RemovedBackground {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  channels: 4
}

export type BackgroundRemover = (image: Buffer) => Promise<RemovedBackground>

let removerPromise: Promise<BackgroundRemover> | undefined

async function loadRemover(): Promise<BackgroundRemover> {
  const cacheDir =
    process.env.FORGE_MODEL_CACHE ?? join(homedir(), 'Library', 'Caches', 'forge', 'models')
  await mkdir(cacheDir, { recursive: true })

  const { AutoModel, AutoProcessor, env, LogLevel, RawImage } = await import(
    '@huggingface/transformers'
  )
  // Core/engines return data and never write to a terminal. In particular,
  // the generic model loader otherwise warns about the pinned custom graph.
  env.logLevel = LogLevel.NONE
  const modelOptions = { cache_dir: cacheDir, dtype: 'q8' as const, revision: MODEL_REVISION }
  const [model, processor] = await Promise.all([
    AutoModel.from_pretrained(MODEL, modelOptions),
    AutoProcessor.from_pretrained(MODEL, modelOptions),
  ])

  return async (input) => {
    const image = await RawImage.fromBlob(new Blob([new Uint8Array(input)], { type: 'image/png' }))
    const { pixel_values: pixelValues } = await processor(image)
    if (!pixelValues) throw new Error('the background-removal processor returned no pixels')
    const output = await model({ input_image: pixelValues })
    const matte = output.output_image
    if (!matte || matte.dims.length < 2) {
      throw new Error('the background-removal model returned no matte')
    }

    const width = matte.dims.at(-1) ?? 0
    const height = matte.dims.at(-2) ?? 0
    const values = matte.data
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < values.length; i++) {
      const value = Number(values[i])
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    const scale = max > min ? 255 / (max - min) : 0
    const alpha = new Uint8Array(values.length)
    for (let i = 0; i < values.length; i++) {
      alpha[i] = Math.round((Number(values[i]) - min) * scale)
    }

    const mask = await new RawImage(alpha, width, height, 1).resize(image.width, image.height)
    const outputImage = image.clone().rgba().putAlpha(mask)
    return {
      data: outputImage.data,
      width: outputImage.width,
      height: outputImage.height,
      channels: 4,
    }
  }
}

/** Loads the model once per process; Transformers.js handles the persistent disk cache. */
export async function removeImageBackground(image: Buffer): Promise<RemovedBackground> {
  removerPromise ??= loadRemover().catch((error) => {
    removerPromise = undefined
    throw error
  })
  return (await removerPromise)(image)
}
