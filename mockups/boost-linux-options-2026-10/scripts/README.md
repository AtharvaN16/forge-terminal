How the numbers on boost-linux-options-2026-10.html were made (2026-10-25, Apple M2, CPU only).

- `export.py <name> 256`: a candidate's .pth to a fixed 256 px ONNX (spandrel + torch).
- `quant.py`: today's model to int8 (ONNX Runtime static QDQ, per-channel, calibrated on 12 Kodak images).
- `bench_node.mjs`: ms per tile with the onnxruntime-node Forge ships (1.23.2), CPU provider only.
- `bench_ort.py`, `bench_ncnn.py`, `bench_mnn.py`, `bench_ov.py`: the same tile in ONNX Runtime (Python), ncnn, MNN, OpenVINO.
- `quality.py clean|jpeg [step]`: 2x upscaling of the Kodak set (half-size Lanczos, or half-size then JPEG q70) in the runner's own tiling; PSNR, SSIM, LPIPS (alex) against the original and against today's output.
- `montage.py`: the crops on the page.

The Kodak images (https://r0k.us/graphics/kodak/) are free for research use and are not kept here.
Model weights come from OpenModelDB (licences on the page).
