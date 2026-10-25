import sys, time, resource, numpy as np, openvino as ov
from PIL import Image
path, tile, threads, prec = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
core = ov.Core()
cfg = {'INFERENCE_NUM_THREADS': threads, 'PERFORMANCE_HINT': 'LATENCY', 'INFERENCE_PRECISION_HINT': prec}
m = core.read_model(path)
c = core.compile_model(m, 'CPU', cfg)
img = np.asarray(Image.open('/tmp/boost-lin/kodak/kodim08.png').convert('RGB'), dtype=np.float32) / 255
x = np.ascontiguousarray(img[:tile, :tile].transpose(2, 0, 1)[None])
req = c.create_infer_request()
req.infer({0: x})
ts = []
for _ in range(5):
    t = time.perf_counter(); req.infer({0: x}); ts.append(time.perf_counter() - t)
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576
print(f'openvino {path.split("/")[-1]} tile {tile} threads {threads} {prec}: median {np.median(ts)*1000:.0f} ms/tile peakRSS {rss:.0f} MB')
