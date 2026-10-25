/**
 * What the Boost runner asks ONNX Runtime for, and when it gives up. Pure, so
 * both can be tested without a model, a graphics card or the binary.
 *
 * Where each provider comes from (onnxruntime-node 1.23.2's own binaries):
 * DirectML on Windows, CoreML on macOS, WebGPU on Intel Macs (Metal). Linux,
 * both chips, does not use ONNX Runtime: it runs the same model through ncnn.
 */

export type Provider = 'webgpu' | 'coreml' | 'dml' | 'cpu'

export interface Plan {
  /** What runs the model: ONNX Runtime (engine-ort.ts) or ncnn (engine-ncnn.ts). */
  engine: 'ort' | 'ncnn'
  /** ONNX Runtime's providers in the order they are asked for; the CPU is always last. Empty for ncnn. */
  providers: readonly Provider[]
  /**
   * Whether the run is cut short when it would take too long. Only where the
   * processor alone is what a missing graphics card leaves: Linux, and Intel
   * Macs, which were not offered Boost until WebGPU gave them a way. Windows
   * and Apple silicon run as long as they take, as they always have.
   */
  guarded: boolean
  /** How long a guarded run may be projected to take before it stops. */
  limitMs: number
}

/** Intel Macs: three minutes. Past that the graphics chip is not doing the work. */
export const TOO_SLOW_MS = 180_000
/**
 * Linux: fifteen minutes. The processor is the floor here, not a failure
 * (ncnn on a Raspberry Pi 5 is estimated at two to three minutes for a 12
 * megapixel photo, a Pi 4 at eight), so the limit only stops a job nobody
 * would wait for.
 */
export const NCNN_TOO_SLOW_MS = 900_000

export function providerPlan(platform: NodeJS.Platform, arch: string): Plan {
  if (platform === 'win32')
    return { engine: 'ort', providers: ['dml', 'cpu'], guarded: false, limitMs: TOO_SLOW_MS }
  // Linux, both chips: ncnn on the graphics card if there is a real one, else on the processor.
  if (platform === 'linux')
    return { engine: 'ncnn', providers: [], guarded: true, limitMs: NCNN_TOO_SLOW_MS }
  if (platform === 'darwin' && arch === 'x64')
    return {
      engine: 'ort',
      providers: ['webgpu', 'coreml', 'cpu'],
      guarded: true,
      limitMs: TOO_SLOW_MS,
    }
  // Apple silicon, and what has always been asked of anything else: CoreML.
  return { engine: 'ort', providers: ['coreml', 'cpu'], guarded: false, limitMs: TOO_SLOW_MS }
}

/**
 * Threads for ONNX Runtime's CPU provider when it is all a session has: every
 * core but one, which is left to the runner's own work beside the model (each
 * band of the PNG is filtered and compressed while the next tiles are made),
 * never fewer than the two it always had and no more than eight. Measured on
 * an Apple M2, CPU only: 971 ms a tile on 2 threads, 566 on 4 (1.7×); its
 * efficiency cores added little past that (mockups/boost-linux-options-2026-10).
 */
export function cpuThreads(cores: number): number {
  return Math.max(2, Math.min(8, cores - 1))
}

/**
 * Threads for a session asked for `providers`, on a computer of `cores`. Where
 * a graphics provider comes first it does the model's work and the CPU provider
 * only what it leaves, so the two this runner has always used stay: CoreML on an
 * M2 made a tile in 31 ms on 2 threads and 32 on 7.
 */
export function ortThreads(providers: readonly Provider[], cores: number): number {
  return providers.every((p) => p === 'cpu') ? cpuThreads(cores) : 2
}

/** A Vulkan device as forge-ncnn --devices lists it. */
export interface Device {
  index: number
  name: string
  kind: string
}

/**
 * Names of Vulkan "devices" that are the processor in disguise: Mesa's
 * llvmpipe, lavapipe and softpipe, Google's SwiftShader, Microsoft's WARP and
 * Basic Render Driver, and anything that calls itself software.
 */
const SOFTWARE_NAME = /llvmpipe|lavapipe|softpipe|swiftshader|\bwarp\b|basic render|software/i

/**
 * The device to run on, or none. Turns away a software adapter by its name
 * (and one that reports itself as a CPU or as something it does not say), then
 * prefers a discrete card over an integrated chip over a virtual one.
 */
export function pickDevice(devices: readonly Device[]): Device | undefined {
  const rank: Record<string, number> = { discrete: 0, integrated: 1, virtual: 2 }
  return devices
    .filter((d) => !SOFTWARE_NAME.test(d.name) && d.kind in rank)
    .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.index - b.index)[0]
}

/** How many tiles an image is cut into, `step` pixels of it at a time. */
export function tileCount(width: number, height: number, step: number): number {
  return Math.ceil(width / step) * Math.ceil(height / step)
}

export type Verdict = { slow: false } | { slow: true; projectedMs: number }

/**
 * Whether the run so far says it will not finish within the limit, from how
 * long each tile has taken (the whole of its turn: reading, the model, writing
 * back). Judged twice only.
 *
 * - After the first tile, only if that one tile alone is past the limit. A
 *   graphics provider spends its first tile compiling shaders, so its time
 *   would project far too much over a long image.
 * - After the second tile, which is what a tile really costs here: the first
 *   one as it was, then this one for each of the rest.
 *
 * A software adapter (llvmpipe, SwiftShader) looks like a graphics card to
 * ONNX Runtime and is no faster than the processor, so this is what finds it.
 */
export function judge(tileMs: readonly number[], total: number, limitMs = TOO_SLOW_MS): Verdict {
  const [first, second] = tileMs
  if (tileMs.length === 1 && first !== undefined && first > limitMs)
    return { slow: true, projectedMs: first * total }
  if (tileMs.length === 2 && first !== undefined && second !== undefined) {
    const projectedMs = first + second * (total - 1)
    if (projectedMs > limitMs) return { slow: true, projectedMs }
  }
  return { slow: false }
}
