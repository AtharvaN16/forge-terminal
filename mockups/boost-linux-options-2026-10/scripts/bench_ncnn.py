import sys, time, resource, numpy as np, ncnn
from PIL import Image
param, binf, tile, threads = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
fp16 = len(sys.argv) > 5 and sys.argv[5] == 'fp16'
IN, OUT = ('data', 'output') if 'realesr-general' in param else ('in0', 'out0')
n = ncnn.Net()
n.opt.use_vulkan_compute = False
n.opt.num_threads = threads
n.opt.use_fp16_packed = fp16; n.opt.use_fp16_storage = fp16; n.opt.use_fp16_arithmetic = fp16
n.load_param(param); n.load_model(binf)
img = np.asarray(Image.open('/tmp/boost-lin/kodak/kodim08.png').convert('RGB'), dtype=np.float32) / 255
x = np.ascontiguousarray(img[:tile, :tile].transpose(2, 0, 1))
def run():
    ex = n.create_extractor()
    ex.input(IN, ncnn.Mat(x).clone())
    r, o = ex.extract(OUT); return np.array(o)
run()
ts = []
for _ in range(5):
    t = time.perf_counter(); run(); ts.append(time.perf_counter() - t)
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576
print(f'ncnn {param.split("/")[-1]} tile {tile} threads {threads} fp16={fp16}: median {np.median(ts)*1000:.0f} ms/tile peakRSS {rss:.0f} MB')
