import sys, time, resource, numpy as np
import MNN.nn as nn, MNN.expr as F
from PIL import Image
path, tile, threads, prec = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
rt = nn.create_runtime_manager(({'backend': 'CPU', 'precision': prec, 'numThread': threads},))
m = nn.load_module_from_file(path, ['input'], ['output'], runtime_manager=rt)
img = np.asarray(Image.open('/tmp/boost-lin/kodak/kodim08.png').convert('RGB'), dtype=np.float32) / 255
x = np.ascontiguousarray(img[:tile, :tile].transpose(2, 0, 1)[None])
var = F.const(x.flatten().tolist(), [1, 3, tile, tile], F.NCHW)
def run():
    out = m.forward(var)
    return out.read() if hasattr(out, 'read') else out[0].read()
run()
ts = []
for _ in range(5):
    t = time.perf_counter(); run(); ts.append(time.perf_counter() - t)
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576
print(f'mnn {path.split("/")[-1]} tile {tile} threads {threads} {prec}: median {np.median(ts)*1000:.0f} ms/tile peakRSS {rss:.0f} MB')
