import sys, glob, numpy as np
from PIL import Image
import onnxruntime as ort
from onnxruntime.quantization import quantize_static, CalibrationDataReader, QuantFormat, QuantType, CalibrationMethod
src, dst, tile = sys.argv[1], sys.argv[2], int(sys.argv[3])
files = sorted(glob.glob('/tmp/boost-lin/kodak/*.png'))[::2]  # 12 images
class R(CalibrationDataReader):
    def __init__(self):
        self.it = iter(self.tiles())
    def tiles(self):
        for f in files:
            im = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32) / 255
            h, w, _ = im.shape
            for (y, x) in [(0, 0), (h - tile, w - tile), ((h - tile)//2, (w - tile)//2)]:
                yield {'input': np.ascontiguousarray(im[y:y+tile, x:x+tile].transpose(2, 0, 1)[None])}
    def get_next(self): return next(self.it, None)
quantize_static(src, dst, R(), quant_format=QuantFormat.QDQ, per_channel=True,
                activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
                calibrate_method=CalibrationMethod.MinMax,
                extra_options={'ActivationSymmetric': False, 'WeightSymmetric': True})
print('wrote', dst)
