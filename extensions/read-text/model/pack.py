# usage: pack.py <in.onnx> <out.onnx>
#
# Stores a PP-OCR recogniser's weights in half precision and casts them back to
# float32 when the model loads. The graph, its inputs and outputs, and every
# value it computes with are the same; the file is about half the size, and
# on 28 test pages it reads exactly as the original does (README.md).
#
# Weights are the FLOAT tensors of 64 or more values, whether the export keeps
# them as initialisers (PP-OCRv6) or in Constant nodes (the older PP-OCRv5
# exports). Run with the tools pinned in requirements.txt: the output is the
# same bytes every time.
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

MIN_VALUES = 64


def halves(t):
    """The tensor as float16, or None when it is too small or does not fit."""
    if t.data_type != TensorProto.FLOAT or int(np.prod(t.dims or [1])) < MIN_VALUES:
        return None
    h = numpy_helper.to_array(t).astype(np.float16)
    return h if np.all(np.isfinite(h)) else None


def main(src, dst):
    m = onnx.load(src)
    g = m.graph
    keep, casts, packed = [], [], set()
    for i in g.initializer:
        h = halves(i)
        if h is None:
            keep.append(i)
            continue
        new = i.name + "__f16"
        keep.append(numpy_helper.from_array(h, new))
        casts.append(helper.make_node("Cast", [new], [i.name], to=TensorProto.FLOAT, name=new + "_cast"))
        packed.add(i.name)
    del g.initializer[:]
    g.initializer.extend(keep)
    # An initialiser listed among the inputs (IR 3) is now made by its Cast.
    inputs = [i for i in g.input if i.name not in packed]
    del g.input[:]
    g.input.extend(inputs)

    nodes = []
    for n in g.node:
        t = next((a.t for a in n.attribute if a.name == "value"), None) if n.op_type == "Constant" else None
        h = halves(t) if t is not None else None
        if h is None:
            nodes.append(n)
            continue
        new = n.output[0] + "__f16"
        nodes.append(helper.make_node("Constant", [], [new], name=(n.name or n.output[0]) + "__f16", value=numpy_helper.from_array(h)))
        casts.append(helper.make_node("Cast", [new], [n.output[0]], to=TensorProto.FLOAT, name=new + "_cast"))
    del g.node[:]
    g.node.extend(casts + nodes)
    m.ir_version = max(m.ir_version, 4)
    onnx.save(m, dst)
    print(f"{src.split('/')[-1]}: {len(casts)} weight tensors packed")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
