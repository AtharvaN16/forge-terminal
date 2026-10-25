"""2x upscaling quality of each option on the Kodak set: LR = Lanczos half-size of the original; output vs original and vs today's Boost."""
import sys, glob, json, io, os, numpy as np, onnxruntime as ort
from PIL import Image
from skimage.metrics import peak_signal_noise_ratio as psnr, structural_similarity as ssim
import ncnn, torch, lpips
LP = lpips.LPIPS(net='alex', verbose=False)
def lp(a, b):
    t = lambda x: torch.from_numpy(x.astype(np.float32) / 127.5 - 1).permute(2, 0, 1)[None]
    with torch.no_grad(): return float(LP(t(a), t(b)))

TILE, OVERLAP = 256, 16
STEP = TILE - 2 * OVERLAP
O = '/tmp/boost-lin/onnx/'
def ort_fn(path, threads=4):
    so = ort.SessionOptions(); so.intra_op_num_threads = threads
    s = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
    return lambda x: s.run(None, {'input': x[None]})[0][0]
def ncnn_fn(param, binf, fp16):
    n = ncnn.Net(); n.opt.use_vulkan_compute = False; n.opt.num_threads = 4
    n.opt.use_fp16_packed = n.opt.use_fp16_storage = n.opt.use_fp16_arithmetic = fp16
    n.load_param(param); n.load_model(binf)
    IN, OUT = ('data', 'output') if 'realesr-general' in param else ('in0', 'out0')
    def f(x):
        ex = n.create_extractor(); ex.input(IN, ncnn.Mat(np.ascontiguousarray(x)).clone())
        r, o = ex.extract(OUT); return np.array(o)
    return f

def up(fn, scale, lr, out_scale=2):
    """The runner's way: edge-clamped 256 tiles, 16 px overlap, keep each tile's core; a 4x model is brought down with Lanczos."""
    h, w, _ = lr.shape
    out = np.zeros((h * scale, w * scale, 3), np.float32)
    for cy in range(0, h, STEP):
        for cx in range(0, w, STEP):
            ys = np.clip(np.arange(cy - OVERLAP, cy - OVERLAP + TILE), 0, h - 1)
            xs = np.clip(np.arange(cx - OVERLAP, cx - OVERLAP + TILE), 0, w - 1)
            t = lr[np.ix_(ys, xs)].transpose(2, 0, 1)
            y = np.clip(fn(np.ascontiguousarray(t, dtype=np.float32)), 0, 1)
            bh, bw = min(STEP, h - cy), min(STEP, w - cx)
            core = y[:, OVERLAP * scale:(OVERLAP + bh) * scale, OVERLAP * scale:(OVERLAP + bw) * scale]
            out[cy * scale:(cy + bh) * scale, cx * scale:(cx + bw) * scale] = core.transpose(1, 2, 0)
    if scale != out_scale:
        chans = [Image.fromarray(out[:, :, c], 'F').resize((w * out_scale, h * out_scale), Image.LANCZOS) for c in range(3)]
        out = np.stack([np.asarray(c) for c in chans], 2)
    return np.clip(np.round(out * 255), 0, 255).astype(np.uint8)

methods = {
  'lanczos':        None,
  'today':          (ort_fn('/tmp/boost-onnx/realesr-general-x4v3.onnx'), 4),
  'today-int8':     (ort_fn(O + 'general-x4v3-int8.onnx'), 4),
  'today-ncnn-fp16':(ncnn_fn('/tmp/boost-lin/ncnn/realesr-general-x4v3.param', '/tmp/boost-lin/ncnn/realesr-general-x4v3.bin', True), 4),
  'compact2x-multijpg': (ort_fn(O + '2x-NomosUni-compact-multijpg-256.onnx'), 2),
  'compact2x-otf':  (ort_fn(O + '2x-NomosUni-compact-otf-medium-256.onnx'), 2),
  'compact2x-parimg': (ort_fn(O + '2x-ParimgCompact-256.onnx'), 2),
  'lsdir4x':        (ort_fn(O + '4x-LSDIRCompact-v2-256.onnx'), 4),
  'span2x':         (ort_fn(O + '2x-NomosUni-span-multijpg-256.onnx'), 2),
}
scenario = sys.argv[1]  # clean | jpeg
files = sorted(glob.glob('/tmp/boost-lin/kodak/*.png'))
if len(sys.argv) > 2: files = files[::int(sys.argv[2])]
res = {m: {'gt_psnr': [], 'gt_ssim': [], 'gt_lpips': [], 'ref_psnr': [], 'ref_ssim': [], 'ref_lpips': []} for m in methods}
os.makedirs('/tmp/boost-lin/out/' + scenario, exist_ok=True)
for f in files:
    name = os.path.basename(f)[:-4]
    gt = Image.open(f).convert('RGB')
    lr = gt.resize((gt.width // 2, gt.height // 2), Image.LANCZOS)
    if scenario == 'jpeg':
        b = io.BytesIO(); lr.save(b, 'JPEG', quality=70); lr = Image.open(io.BytesIO(b.getvalue())).convert('RGB')
    lr_f = np.asarray(lr, np.float32) / 255
    gt_a = np.asarray(gt, np.uint8)
    outs = {}
    for m, spec in methods.items():
        outs[m] = np.asarray(lr.resize(gt.size, Image.LANCZOS), np.uint8) if spec is None else up(spec[0], spec[1], lr_f)
    for m, o in outs.items():
        res[m]['gt_psnr'].append(psnr(gt_a, o, data_range=255)); res[m]['gt_ssim'].append(ssim(gt_a, o, channel_axis=2, data_range=255))
        res[m]['gt_lpips'].append(lp(gt_a, o))
        res[m]['ref_lpips'].append(lp(outs['today'], o) if m != 'today' else float('nan'))
        res[m]['ref_psnr'].append(psnr(outs['today'], o, data_range=255) if m != 'today' else float('nan'))
        res[m]['ref_ssim'].append(ssim(outs['today'], o, channel_axis=2, data_range=255) if m != 'today' else float('nan'))
        if name in ('kodim01', 'kodim08', 'kodim13', 'kodim15', 'kodim23'):
            Image.fromarray(o).save(f'/tmp/boost-lin/out/{scenario}/{name}-{m}.png')
    if name in ('kodim01', 'kodim08', 'kodim13', 'kodim15', 'kodim23'):
        gt.save(f'/tmp/boost-lin/out/{scenario}/{name}-gt.png'); lr.save(f'/tmp/boost-lin/out/{scenario}/{name}-lr.png')
    print(name, flush=True)
import warnings; warnings.simplefilter('ignore')
summary = {m: {k: float(np.nanmean(v)) for k, v in d.items()} for m, d in res.items()}
json.dump(summary, open(f'/tmp/boost-lin/out/quality-{scenario}.json', 'w'), indent=1)
for m, d in summary.items():
    print(f'{m:20s} vsGT psnr {d["gt_psnr"]:.2f} ssim {d["gt_ssim"]:.4f} | lpips {d["gt_lpips"]:.3f} | vs today psnr {d["ref_psnr"]:.2f} ssim {d["ref_ssim"]:.4f} lpips {d["ref_lpips"]:.3f}')
