/**
 * What the Boost runner asks ONNX Runtime for, and when it gives up. Pure, so
 * both can be tested without a model, a graphics card or the binary.
 *
 * Where each provider comes from (onnxruntime-node 1.23.2's own binaries):
 * DirectML on Windows, CoreML on macOS, WebGPU on Linux x64 and macOS (Metal on
 * a Mac, Vulkan on Linux). Linux arm64's binary has no WebGPU in it.
 */

export type Provider = 'webgpu' | 'coreml' | 'dml' | 'cpu'

export interface Plan {
  /** In the order they are asked for; the CPU is always last. */
  providers: readonly Provider[]
  /**
   * Whether the run is cut short when it would take minutes. Only where the
   * processor alone is what a missing graphics card leaves: Linux x64 and Intel
   * Macs, which were not offered Boost until WebGPU gave them a way. Windows
   * and Apple silicon run as long as they take, as they always have.
   */
  guarded: boolean
}

export function providerPlan(platform: NodeJS.Platform, arch: string): Plan {
  if (platform === 'win32') return { providers: ['dml', 'cpu'], guarded: false }
  if (platform === 'linux' && arch === 'x64') return { providers: ['webgpu', 'cpu'], guarded: true }
  if (platform === 'darwin' && arch === 'x64')
    return { providers: ['webgpu', 'coreml', 'cpu'], guarded: true }
  // Apple silicon, and what has always been asked of anything else: CoreML,
  // which ONNX Runtime drops itself where it does not exist (Linux arm64).
  return { providers: ['coreml', 'cpu'], guarded: false }
}

/** How long a guarded run may be projected to take before it stops: three minutes. */
export const TOO_SLOW_MS = 180_000

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
