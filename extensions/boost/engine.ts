/**
 * What the Boost runner needs from whatever runs the model: a 256 px tile in,
 * the model's 4× tile out. ONNX Runtime does it on Windows and the Macs
 * (engine-ort.ts), ncnn on Linux (engine-ncnn.ts).
 */

/** The tile the model is run on, a side in pixels. */
export const TILE = 256
/** What the model enlarges by; every other factor is this one brought down. */
export const MODEL_SCALE = 4
/** A tile out: a side in pixels. */
export const TILE_OUT = TILE * MODEL_SCALE

export interface TileEngine {
  /**
   * Whether `run` may be called again before the last call has answered, the
   * answers coming back in order. Then the runner works on one tile's result
   * while the next is being made.
   */
  readonly pipelined: boolean
  /**
   * `tile` is TILE × TILE × 3 bytes (R, G, B for each pixel, row by row). The
   * answer is three TILE_OUT × TILE_OUT planes (R, then G, then B) of floats, 0
   * to 1 where the model is sure and a little past where it is not.
   */
  run(tile: Uint8Array): Promise<Float32Array>
  /** Time spent since the last call on checking itself rather than on tiles, in ms; the too-slow guard leaves it out. */
  takeOverheadMs?(): number
  /**
   * An image of `tiles` tiles comes next. An engine is opened once and kept
   * for every image a `--serve` runner is given, so what it decides by the
   * size of the image is told it here, each image.
   */
  startImage?(tiles: number): void
  close(): Promise<void>
}
