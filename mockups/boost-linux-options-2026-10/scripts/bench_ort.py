"""ms per tile for an ONNX model on the CPU provider only: python bench_ort.py model.onnx tile threads [n]"""
import sys, time, resource, numpy as np, onnxruntime as ort
from PIL import Image
path, tile, threads = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
n = int(sys.argv[4]) if len(sys.argv) > 4 else 6
so = ort.SessionOptions()
so.intra_op_num_threads = threads
so.inter_op_num_threads = 1
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
t0 = time.time()
s = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
load = time.time() - t0
img = np.asarray(Image.open('/tmp/boost-lin/kodak/kodim08.png').convert('RGB'), dtype=np.float32) / 255
x = np.ascontiguousarray(img[:tile, :tile].transpose(2, 0, 1)[None]) if img.shape[0] >= tile and img.shape[1] >= tile else None
if x is None:
    big = np.asarray(Image.open('/tmp/boost-lin/kodak/kodim08.png').convert('RGB').resize((tile, tile)), dtype=np.float32) / 255
    x = np.ascontiguousarray(big.transpose(2, 0, 1)[None])
name = s.get_inputs()[0].name
s.run(None, {name: x})  # warm-up
ts = []
for _ in range(n):
    t = time.perf_counter(); s.run(None, {name: x}); ts.append(time.perf_counter() - t)
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576
print(f'{path.split("/")[-1]} tile {tile} threads {threads}: median {np.median(ts)*1000:.0f} ms/tile  (min {min(ts)*1000:.0f})  load {load:.2f}s  peakRSS {rss:.0f} MB')
