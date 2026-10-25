# usage: shrink.py <in fp32.onnx> <out int8.onnx>
# 1. drop Identity nodes that only forward weights, so the quantiser sees them
# 2. dynamic int8 (MatMul + Conv weights) — deliberately WITHOUT ONNX Runtime's pre-optimiser: it folds small attention masks into ~70 MB of tables
# 3. DeformConv weights (no int8 form exists) stored as fp16 and cast back to fp32 on load
import sys, os, onnx, numpy as np
from onnx import numpy_helper, helper, TensorProto
from onnxruntime.quantization import quantize_dynamic, QuantType
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src); g = m.graph
init = {i.name for i in g.initializer}
rename, keep = {}, []
for n in g.node:
    if n.op_type == 'Identity' and (n.input[0] in init or n.input[0] in rename): rename[n.output[0]] = rename.get(n.input[0], n.input[0])
    else: keep.append(n)
for n in keep:
    for k, x in enumerate(n.input):
        if x in rename: n.input[k] = rename[x]
del g.node[:]; g.node.extend(keep)
tmp = dst + '.tmp1.onnx'; onnx.save(m, tmp)
tmp2 = dst + '.tmp2.onnx'; quantize_dynamic(tmp, tmp2, weight_type=QuantType.QUInt8)
m = onnx.load(tmp2); g = m.graph
init = {i.name: i for i in g.initializer}
want = {n.input[1] for n in g.node if n.op_type == 'DeformConv' and n.input[1] in init}
keep_i, casts = [], []
for i in g.initializer:
    if i.name in want and i.data_type == TensorProto.FLOAT:
        new = i.name + '__f16'; keep_i.append(numpy_helper.from_array(numpy_helper.to_array(i).astype(np.float16), new))
        casts.append(helper.make_node('Cast', [new], [i.name], to=TensorProto.FLOAT, name=new + '_cast'))
    else: keep_i.append(i)
del g.initializer[:]; g.initializer.extend(keep_i)
nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
onnx.save(m, dst); os.remove(tmp); os.remove(tmp2); print('wrote', dst, os.path.getsize(dst))
