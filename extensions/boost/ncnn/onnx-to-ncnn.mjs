/**
 * realesr-general-x4v3 from its ONNX file to ncnn's two files (.param, .bin).
 *
 * Boost's model is one fixed network (Real-ESRGAN's SRVGGNetCompact: 34
 * convolutions, 33 PReLU, a pixel shuffle, and the input enlarged 4× by
 * nearest and added; convert.py writes that last step as 16 copies of the
 * input added before the shuffle, which is the same thing). Rather than a
 * general converter, this reads the pinned
 * ONNX file (model.json), checks it is exactly that network, and writes the
 * ncnn layers for it with the weights copied over as 32-bit floats: nothing is
 * rounded, nothing is fused, so ncnn runs the model that ONNX Runtime does.
 *
 * Pure Node, no Python: the Linux build has to make the same bytes anywhere.
 */

/** One protobuf message as a list of [field number, wire type, value]. */
function fields(buf) {
  const out = []
  let at = 0
  const varint = () => {
    let result = 0n
    let shift = 0n
    for (;;) {
      const b = buf[at++]
      if (b === undefined) throw new Error('truncated protobuf')
      result |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return result
      shift += 7n
    }
  }
  while (at < buf.length) {
    const key = Number(varint())
    const field = key >>> 3
    const wire = key & 7
    if (wire === 0) out.push([field, 0, varint()])
    else if (wire === 2) {
      const len = Number(varint())
      out.push([field, 2, buf.subarray(at, at + len)])
      at += len
    } else if (wire === 5) {
      out.push([field, 5, buf.subarray(at, at + 4)])
      at += 4
    } else if (wire === 1) {
      out.push([field, 1, buf.subarray(at, at + 8)])
      at += 8
    } else throw new Error(`unsupported protobuf wire type ${wire}`)
  }
  return out
}

const text = (b) => Buffer.from(b).toString('utf8')

function tensor(buf) {
  const t = { dims: [], type: 0, name: '', raw: undefined, floats: [] }
  for (const [f, w, v] of fields(buf)) {
    if (f === 1) {
      if (w === 0) t.dims.push(Number(v))
      else for (const [, , d] of fieldsPacked(v)) t.dims.push(Number(d))
    } else if (f === 2) t.type = Number(v)
    else if (f === 8) t.name = text(v)
    else if (f === 9) t.raw = v
    else if (f === 4) {
      const f32 = new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.length))
      t.floats.push(...f32)
    }
  }
  return t
}

/** The varints of a packed repeated field. */
function fieldsPacked(buf) {
  const out = []
  let at = 0
  while (at < buf.length) {
    let result = 0n
    let shift = 0n
    for (;;) {
      const b = buf[at++]
      result |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) break
      shift += 7n
    }
    out.push([0, 0, result])
  }
  return out
}

function node(buf) {
  const n = { inputs: [], outputs: [], op: '', attrs: {} }
  for (const [f, , v] of fields(buf)) {
    if (f === 1) n.inputs.push(text(v))
    else if (f === 2) n.outputs.push(text(v))
    else if (f === 4) n.op = text(v)
    else if (f === 5) {
      const a = { name: '', i: undefined, s: undefined, ints: [] }
      for (const [af, aw, av] of fields(v)) {
        if (af === 1) a.name = text(av)
        else if (af === 3) a.i = Number(av)
        else if (af === 4) a.s = text(av)
        else if (af === 8) {
          if (aw === 0) a.ints.push(Number(av))
          else for (const [, , d] of fieldsPacked(av)) a.ints.push(Number(d))
        }
      }
      n.attrs[a.name] = a
    }
  }
  return n
}

/** The nodes of the graph in order, and its weights by name (32-bit floats). */
export function readOnnx(buf) {
  const model = fields(buf)
  const graphBuf = model.find(([f]) => f === 7)?.[2]
  if (!graphBuf) throw new Error('not an ONNX model: no graph')
  const nodes = []
  const weights = new Map()
  for (const [f, , v] of fields(graphBuf)) {
    if (f === 1) nodes.push(node(v))
    else if (f === 5) {
      const t = tensor(v)
      if (t.type !== 1) throw new Error(`weight ${t.name} is not float32 (type ${t.type})`)
      const data = t.raw
        ? new Float32Array(t.raw.buffer.slice(t.raw.byteOffset, t.raw.byteOffset + t.raw.length))
        : Float32Array.from(t.floats)
      weights.set(t.name, { dims: t.dims, data })
    }
  }
  return { nodes, weights }
}

const must = (cond, what) => {
  if (!cond) throw new Error(`model is not realesr-general-x4v3 as expected: ${what}`)
}

/**
 * The ncnn files for the network. Throws if the ONNX file is anything but
 * (Conv, PRelu) × 33, Conv, Concat (16 copies of the input), Add, DepthToSpace(4).
 */
export function onnxToNcnn(onnx) {
  const { nodes, weights } = readOnnx(onnx)
  const FEAT = 64
  const BODY = 33
  const ops = nodes.map((n) => n.op)
  const expect = []
  for (let i = 0; i < BODY; i++) expect.push('Conv', 'PRelu')
  expect.push('Conv', 'Concat', 'Add', 'DepthToSpace')
  must(
    ops.length === expect.length && ops.every((o, i) => o === expect[i]),
    `layers are ${ops.join(',')}`,
  )

  const lines = []
  const bin = []
  let blob = 0
  const next = () => `b${blob++}`
  const f32 = (arr) => bin.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))

  lines.push('Input input 0 1 data')
  lines.push('Split split 1 2 data x_conv x_skip')
  let current = 'x_conv'
  let inChannels = 3
  let layer = 0
  for (let pair = 0; pair < BODY; pair++) {
    const i = 2 * pair
    const conv = nodes[i]
    must(conv.op === 'Conv', `node ${i}`)
    const w = weights.get(conv.inputs[1])
    const b = weights.get(conv.inputs[2])
    must(w && b, `weights of node ${i}`)
    const [outC, inC, kh, kw] = w.dims
    must(kh === 3 && kw === 3 && inC === inChannels, `conv ${i} shape ${w.dims}`)
    must(
      conv.attrs.pads?.ints.join() === '1,1,1,1' &&
        conv.attrs.strides?.ints.join() === '1,1' &&
        (conv.attrs.group?.i ?? 1) === 1,
      `conv ${i} pads/strides/group`,
    )
    must(b.data.length === outC, `conv ${i} bias`)
    const out = next()
    lines.push(
      `Convolution conv${layer} 1 1 ${current} ${out} 0=${outC} 1=3 11=3 2=1 12=1 3=1 13=1 4=1 14=1 15=1 16=1 5=1 6=${w.data.length}`,
    )
    bin.push(Buffer.alloc(4)) // tag 0: float32 follows
    f32(w.data)
    f32(b.data)
    current = out
    inChannels = outC
    const act = nodes[i + 1]
    const slope = weights.get(act.inputs[1])
    must(
      act?.op === 'PRelu' && slope && slope.data.length === outC && outC === FEAT,
      `prelu ${i + 1}`,
    )
    const o2 = next()
    lines.push(`PReLU prelu${layer} 1 1 ${current} ${o2} 0=${outC}`)
    f32(slope.data)
    current = o2
    layer++
  }
  // After the 33 pairs: the last Conv (48 channels), the shuffle, the enlarged input, the sum.
  const lastConv = nodes[2 * BODY]
  must(lastConv?.op === 'Conv', 'final convolution')
  const lw = weights.get(lastConv.inputs[1])
  const lb = weights.get(lastConv.inputs[2])
  must(lw && lb && lw.dims[0] === 48 && lw.dims[1] === FEAT, 'final convolution shape')
  const shuffled = next()
  lines.push(
    `Convolution conv${layer} 1 1 ${current} ${shuffled} 0=48 1=3 11=3 2=1 12=1 3=1 13=1 4=1 14=1 15=1 16=1 5=1 6=${lw.data.length}`,
  )
  bin.push(Buffer.alloc(4))
  f32(lw.data)
  f32(lb.data)

  // The input's 16 copies, side by side in channels: after the shuffle, the input enlarged 4× by nearest.
  const concat = nodes[2 * BODY + 1]
  const add = nodes[2 * BODY + 2]
  const shuffle = nodes[2 * BODY + 3]
  must(
    concat?.inputs.length === 16 &&
      concat.inputs.every((x) => x === concat.inputs[0]) &&
      concat.attrs.axis?.i === 1,
    'the skip is the input 16 times in channels',
  )
  must(
    add?.inputs.length === 2 &&
      add.inputs.includes(lastConv.outputs[0]) &&
      add.inputs.includes(concat.outputs[0]),
    'the skip is added to the last convolution',
  )
  must(shuffle?.attrs.blocksize?.i === 4, 'pixel shuffle block size')
  // DepthToSpace's default, DCR, is ncnn's PixelShuffle mode 1 (mode 0 is torch's CRD order).
  must((shuffle.attrs.mode?.s ?? 'DCR') === 'DCR', 'pixel shuffle mode')
  const up = next()
  lines.push(`PixelShuffle shuffle 1 1 ${shuffled} ${up} 0=4 1=1`)
  lines.push('Interp skip 1 1 x_skip skip4 0=1 1=4.000000e+00 2=4.000000e+00 3=0 4=0 6=0')
  lines.push(`BinaryOp sum 2 1 ${up} skip4 output 0=0`)

  // blobs: data, x_conv, x_skip, the numbered ones, skip4, output
  const header = `7767517\n${lines.length} ${blob + 5}\n`
  return { param: `${header}${lines.join('\n')}\n`, bin: Buffer.concat(bin) }
}
