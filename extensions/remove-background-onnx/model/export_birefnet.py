# usage: export_birefnet.py <repo dir> <weights.pth> <size> <out.onnx>
# BiRefNet-lite (swin_v1_tiny backbone) -> ONNX at one fixed square size. Deformable convolutions become ONNX's own DeformConv
# (opset 19), which ONNX Runtime runs directly. The older export turned them into huge lookup tables, which is where 13 GB went.
import sys, os, shutil, torch
repo, pth, size, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
src = repo + '-tiny'
if not os.path.exists(src):
    shutil.copytree(repo, src)
    c = open(src + '/config.py').read()
    old = "'dino_v3_b', 'dino_v3_s_plus', 'dino_v3_s',\n        ][3]"
    assert old in c, 'config.py changed: pick swin_v1_t by hand'
    open(src + '/config.py', 'w').write(c.replace(old, old.replace('][3]', '][6]')))
sys.path.insert(0, src); os.chdir(src)
from utils import check_state_dict
from models.birefnet import BiRefNet
m = BiRefNet(bb_pretrained=False)
m.load_state_dict(check_state_dict(torch.load(pth, map_location='cpu', weights_only=True)))
m.eval(); assert m.config.bb == 'swin_v1_t', m.config.bb
def sym(g, input, weight, offset, mask, bias, sh, sw, ph, pw, dh, dw, n_w_grps, n_off_grps, use_mask):
    from torch.onnx import symbolic_helper as H
    sh, sw, ph, pw, dh, dw, n_w_grps, n_off_grps = [H._get_const(v, 'i', 'p') for v in (sh, sw, ph, pw, dh, dw, n_w_grps, n_off_grps)]
    k = weight.type().sizes()[2:]
    return g.op('DeformConv', input, weight, offset, bias, mask, dilations_i=[dh, dw], group_i=n_w_grps, kernel_shape_i=list(k), offset_group_i=n_off_grps, pads_i=[ph, pw, ph, pw], strides_i=[sh, sw])
torch.onnx.register_custom_op_symbolic('torchvision::deform_conv2d', sym, 19)
class W(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x):
        o = s.m(x); return o[-1] if isinstance(o, (list, tuple)) else o
with torch.no_grad():
    torch.onnx.export(W(m), torch.randn(1, 3, size, size), out, opset_version=19, input_names=['input_image'], output_names=['output_image'], dynamo=False)
print('exported', out)
