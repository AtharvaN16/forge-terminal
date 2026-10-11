"""Convert the upstream Real-ESRGAN `realesr-general-x4v3.pth` to ONNX.

usage: python3 -I convert.py <realesr-general-x4v3.pth> <out.onnx> [--fixed N]

Standard library only — no torch, no numpy, no onnx package. The checkpoint is
read with a restricted unpickler (only the handful of globals a torch state
dict uses; anything else is refused, so a tampered file cannot run code), and
the ONNX protobuf is written by hand. The output is byte-for-byte deterministic
for a given input, which is what lets model.json pin its sha256.

The network is SRVGGNetCompact (num_feat 64, num_conv 32, upscale 4, PReLU):

    x -> Conv3x3 -> PReLU -> (Conv3x3 -> PReLU) x 32 -> Conv3x3 (48 ch)
      -> PixelShuffle(4) + nearest-upsample(x, 4)

Two equivalent rewrites keep every op on CoreML's supported list:
- PixelShuffle is torch's channel order (CRD). The last conv's output channels
  are permuted so DepthToSpace can run in DCR mode instead.
- The nearest-neighbour skip is added before the shuffle as x concatenated 16
  times along channels — in DCR order that is exactly x repeated in each 4x4
  output block — so no Resize op is needed.

Input `input` float32 [1, 3, h, w] in 0..1 (RGB), output `output` [1, 3, 4h, 4w].
h and w are dynamic unless --fixed N is given.
"""

import io
import pickle
import struct
import sys
import zipfile

SCALE = 4


# ---------------------------------------------------------------- checkpoint


class _StateDict(dict):
    """dict that tolerates the `_metadata` attribute torch sets via BUILD."""


class _Storage:
    def __init__(self, data):
        self.data = data


def _load_state_dict(path):
    zf = zipfile.ZipFile(path)
    names = zf.namelist()
    pkl = next(n for n in names if n.endswith("/data.pkl"))
    prefix = pkl[: -len("data.pkl")]
    byteorder = prefix + "byteorder"
    if byteorder in names and zf.read(byteorder).strip() != b"little":
        raise SystemExit("big-endian checkpoints are not supported")

    def rebuild_tensor(storage, offset, size, stride, *_rest):
        size = tuple(size)
        expect, acc = [], 1
        for d in reversed(size):
            expect.insert(0, acc)
            acc *= d
        if tuple(stride) != tuple(expect):
            raise SystemExit("non-contiguous tensor in checkpoint")
        start = offset * 4
        return (size, storage.data[start : start + acc * 4])

    allowed = {
        ("collections", "OrderedDict"): _StateDict,
        ("torch._utils", "_rebuild_tensor_v2"): rebuild_tensor,
        ("torch", "FloatStorage"): "float32",
    }

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            try:
                return allowed[(module, name)]
            except KeyError:
                raise pickle.UnpicklingError(f"refusing global {module}.{name}") from None

        def persistent_load(self, pid):
            kind, dtype, key, _location, _numel = pid
            if kind != "storage" or dtype != "float32":
                raise pickle.UnpicklingError(f"unsupported storage {pid!r}")
            return _Storage(zf.read(f"{prefix}data/{key}"))

    obj = Unpickler(io.BytesIO(zf.read(pkl))).load()
    for key in ("params_ema", "params"):
        if isinstance(obj, dict) and key in obj:
            return obj[key]
    return obj


# ---------------------------------------------------------------- protobuf


def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field, wire):
    return _varint((field << 3) | wire)


def _int(field, n):
    return _key(field, 0) + _varint(n)


def _bytes(field, b):
    if isinstance(b, str):
        b = b.encode()
    return _key(field, 2) + _varint(len(b)) + b


def _attr_int(name, n):
    return _bytes(1, name) + _int(20, 2) + _int(3, n)  # type INT


def _attr_str(name, s):
    return _bytes(1, name) + _int(20, 3) + _bytes(4, s)  # type STRING


def _attr_ints(name, ns):
    return _bytes(1, name) + _int(20, 7) + b"".join(_int(8, n) for n in ns)  # type INTS


def _node(op, inputs, outputs, name, attrs=()):
    body = b"".join(_bytes(1, i) for i in inputs)
    body += b"".join(_bytes(2, o) for o in outputs)
    body += _bytes(3, name) + _bytes(4, op)
    body += b"".join(_bytes(5, a) for a in attrs)
    return _bytes(1, body)  # GraphProto.node


def _initializer(name, dims, raw):
    body = b"".join(_int(1, d) for d in dims) + _int(2, 1) + _bytes(8, name) + _bytes(9, raw)
    return _bytes(5, body)  # GraphProto.initializer, FLOAT


def _value_info(field, name, dims):
    shape = b""
    for d in dims:
        dim = _int(1, d) if isinstance(d, int) else _bytes(2, d)
        shape += _bytes(1, dim)
    tensor = _int(1, 1) + _bytes(2, shape)  # elem_type FLOAT
    return _bytes(field, _bytes(1, name) + _bytes(2, _bytes(1, tensor)))


# ---------------------------------------------------------------- graph


def build(state, fixed=None):
    convs = sorted(
        {int(k.split(".")[1]) for k in state if k.endswith(".bias")},
    )
    prelus = {int(k.split(".")[1]) for k in state if k.endswith(".weight") and len(state[k][0]) == 1}
    convs = [i for i in convs if i not in prelus]
    last = convs[-1]
    out_ch = state[f"body.{last}.weight"][0][0]
    channels = out_ch // (SCALE * SCALE)
    if channels != 3:
        raise SystemExit(f"expected a 3-channel x{SCALE} model, got {out_ch} output channels")

    nodes, inits = [], []
    cur = "input"
    for idx in sorted(convs + list(prelus)):
        w_size, w_raw = state[f"body.{idx}.weight"]
        out = f"body{idx}"
        if idx in prelus:
            inits.append(_initializer(f"body.{idx}.slope", [w_size[0], 1, 1], w_raw))
            nodes.append(_node("PRelu", [cur, f"body.{idx}.slope"], [out], f"prelu{idx}"))
        else:
            b_size, b_raw = state[f"body.{idx}.bias"]
            if idx == last:
                # torch PixelShuffle (CRD): channel c*16+k. DepthToSpace DCR: k*3+c.
                per = len(w_raw) // out_ch
                w_raw = b"".join(
                    w_raw[(c * 16 + k) * per : (c * 16 + k + 1) * per]
                    for k in range(16)
                    for c in range(channels)
                )
                b_raw = b"".join(
                    b_raw[(c * 16 + k) * 4 : (c * 16 + k + 1) * 4]
                    for k in range(16)
                    for c in range(channels)
                )
            inits.append(_initializer(f"body.{idx}.weight", list(w_size), w_raw))
            inits.append(_initializer(f"body.{idx}.bias", list(b_size), b_raw))
            attrs = [
                _attr_ints("kernel_shape", list(w_size[2:])),
                _attr_ints("pads", [1, 1, 1, 1]),
                _attr_ints("strides", [1, 1]),
            ]
            nodes.append(
                _node(
                    "Conv",
                    [cur, f"body.{idx}.weight", f"body.{idx}.bias"],
                    [out],
                    f"conv{idx}",
                    attrs,
                )
            )
        cur = out

    nodes.append(
        _node("Concat", ["input"] * (SCALE * SCALE), ["base"], "skip", [_attr_int("axis", 1)])
    )
    nodes.append(_node("Add", [cur, "base"], ["sum"], "add"))
    nodes.append(
        _node(
            "DepthToSpace",
            ["sum"],
            ["output"],
            "shuffle",
            [_attr_int("blocksize", SCALE), _attr_str("mode", "DCR")],
        )
    )

    h, w = (fixed, fixed) if fixed else ("h", "w")
    oh, ow = (fixed * SCALE, fixed * SCALE) if fixed else ("H", "W")
    graph = b"".join(nodes) + _bytes(2, "realesr-general-x4v3") + b"".join(inits)
    graph += _value_info(11, "input", [1, 3, h, w])
    graph += _value_info(12, "output", [1, 3, oh, ow])

    model = _int(1, 8)  # ir_version
    model += _bytes(2, "forge convert.py")
    model += _bytes(7, graph)
    model += _bytes(8, _bytes(1, "") + _int(2, 17))  # opset_import ai.onnx 17
    return model


def main(argv):
    if len(argv) not in (2, 4) or (len(argv) == 4 and argv[2] != "--fixed"):
        raise SystemExit(__doc__.split("\n\n")[1])
    fixed = int(argv[3]) if len(argv) == 4 else None
    model = build(_load_state_dict(argv[0]), fixed)
    with open(argv[1], "wb") as f:
        f.write(model)
    print(f"wrote {argv[1]} ({len(model)} bytes)")


if __name__ == "__main__":
    main(sys.argv[1:])
