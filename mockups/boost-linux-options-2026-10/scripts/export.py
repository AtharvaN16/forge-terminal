"""Export each candidate .pth to a fixed-size ONNX (spandrel loads any of the architectures)."""
import sys, torch, spandrel
from spandrel import ModelLoader
name, tile = sys.argv[1], int(sys.argv[2])
m = ModelLoader().load_from_file(f'/tmp/boost-lin/models/{name}.pth')
net = m.model.eval()
print(name, 'arch', m.architecture.id, 'scale', m.scale, 'params', sum(p.numel() for p in net.parameters()))
x = torch.rand(1, 3, tile, tile)
out = f'/tmp/boost-lin/onnx/{name}-{tile}.onnx'
with torch.no_grad():
    torch.onnx.export(net, x, out, input_names=['input'], output_names=['output'], opset_version=17, dynamo=False)
print('wrote', out)
