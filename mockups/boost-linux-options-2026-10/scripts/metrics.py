import sys, numpy as np
from PIL import Image
from skimage.metrics import peak_signal_noise_ratio as psnr, structural_similarity as ssim
def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
a, b = load(sys.argv[1]), load(sys.argv[2])
h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
a, b = a[:h,:w], b[:h,:w]
print(f'psnr {psnr(a,b,data_range=255):.2f} ssim {ssim(a,b,channel_axis=2,data_range=255):.4f}')
