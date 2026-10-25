#!/bin/bash
# Rebuild the small remove-background model from the original weights.   usage: build.sh <empty work dir> [size: 512 | 768]
# Needs python3.12 and git. Downloads ~0.7 GB (torch etc. + 178 MB weights). Export peaks ~2 GB (512) / ~3.7 GB (768).
set -euo pipefail
WORK=${1:?empty work dir}; SIZE=${2:-512}; HERE=$(cd "$(dirname "$0")" && pwd)
REPO_URL=https://github.com/ZhengPeng7/BiRefNet.git
REPO_COMMIT=97e4f35d74043427b0e9ba935ca10991853a36bc
PTH_URL=https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth
PTH_SHA256=6a1e050c6ec2697e5ed268455df544782b023acf8643ab771250979094875ab1
SHA_512_FP32=092595ac508603d413d898b65b69ef07ee7eb309abbeb9518e02e85409cab719
SHA_512_INT8=536e8a74a105d48f556aba67eb5004208bf990d9625b6b2f97792002a27b9bad
SHA_768_INT8=cb6edb75c5b4d1735f43881fb767eb59a59d3770336788b89eaebd8a5ff4e7fc
mkdir -p "$WORK"; cd "$WORK"
python3.12 -m venv venv && ./venv/bin/pip install -q -r "$HERE/requirements.lock.txt"
mkdir -p BiRefNet && (cd BiRefNet && git init -q && git fetch -q --depth 1 "$REPO_URL" "$REPO_COMMIT" && git checkout -q FETCH_HEAD)
curl -sL -o weights.pth "$PTH_URL"; echo "$PTH_SHA256  weights.pth" | shasum -a 256 -c -
./venv/bin/python "$HERE/export_birefnet.py" "$WORK/BiRefNet" "$WORK/weights.pth" "$SIZE" "$WORK/birefnet-lite-$SIZE-fp32.onnx"
./venv/bin/python "$HERE/shrink.py" "$WORK/birefnet-lite-$SIZE-fp32.onnx" "$WORK/birefnet-lite-$SIZE-int8.onnx"
for f in birefnet-lite-$SIZE-fp32.onnx birefnet-lite-$SIZE-int8.onnx; do shasum -a 256 $f; done
eval "echo expected int8: \$SHA_${SIZE}_INT8"
[ "$SIZE" = 512 ] && echo "expected fp32: $SHA_512_FP32" || true
