/**
 * The tile engine on ONNX Runtime: DirectML on Windows, CoreML on Apple
 * silicon, WebGPU (Metal) then CoreML on Intel Macs, the CPU last everywhere
 * (providers.ts).
 */

import { availableParallelism } from 'node:os'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { TILE, type TileEngine } from './engine.js'
import { ortThreads, type Provider } from './providers.js'

type Ort = typeof import('onnxruntime-node')

/** What ONNX Runtime is called by, and what the log says when it will not load. */
const ORT_NAME: Record<Provider, string> = {
  webgpu: 'WebGPU',
  coreml: 'CoreML',
  dml: 'DirectML',
  cpu: 'CPU',
}

function ortProvider(p: Provider): InferenceSession.ExecutionProviderConfig {
  return p === 'coreml' ? { name: 'coreml', coreMlFlags: 0 } : p
}

async function openModel(
  ort: Ort,
  path: string,
  providers: readonly Provider[],
): Promise<InferenceSession> {
  const base = {
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all' as const,
    logSeverityLevel: 3 as const,
  }
  const cores = availableParallelism()
  // The first of `providers` that loads wins; the CPU is always the way out.
  // ONNX Runtime drops a provider it does not have by itself ("not available:
  // backend not found", on stderr) and goes on to the next, so a graphics card
  // that will not start is only found out by how long a tile takes (`judge`).
  try {
    return await ort.InferenceSession.create(path, {
      ...base,
      intraOpNumThreads: ortThreads(providers, cores),
      executionProviders: providers.map(ortProvider),
    })
  } catch (err) {
    const first = providers[0] ?? 'cpu'
    process.stderr.write(`${ORT_NAME[first]} unavailable, using CPU: ${String(err)}\n`)
    return await ort.InferenceSession.create(path, {
      ...base,
      intraOpNumThreads: ortThreads(['cpu'], cores),
      executionProviders: ['cpu'],
    })
  }
}

export async function openEngine(
  modelPath: string,
  providers: readonly Provider[],
): Promise<TileEngine> {
  const ort: Ort = await import('onnxruntime-node')
  const session = await openModel(ort, modelPath, providers)
  const inName = session.inputNames[0] ?? 'input'
  const outName = session.outputNames[0] ?? 'output'
  const n = TILE * TILE
  const input = new Float32Array(3 * n)
  return {
    pipelined: false,
    async run(tile) {
      for (let i = 0; i < n; i++) {
        input[i] = (tile[i * 3] ?? 0) / 255
        input[n + i] = (tile[i * 3 + 1] ?? 0) / 255
        input[2 * n + i] = (tile[i * 3 + 2] ?? 0) / 255
      }
      const result = await session.run({
        [inName]: new ort.Tensor('float32', input, [1, 3, TILE, TILE]),
      })
      return (result[outName] as Tensor).data as Float32Array
    },
    close: () => session.release(),
  }
}
