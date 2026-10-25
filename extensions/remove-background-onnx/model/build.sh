#!/bin/bash
# Rebuilds the remove-background model (BiRefNet-lite, 768 px, int8) from the
# original weights and checks every output against the pinned sha256.
#
#   usage: build.sh <empty work dir> [size]      (size defaults to 768, the shipped one)
#
# Needs python3.12 and git. Downloads about 0.7 GB (torch and friends, the 178 MB
# weights). The export peaks near 3.7 GB of memory at 768; it needs no GPU.
# Other sizes (512, say) build the same way and print their hashes without checking.
set -euo pipefail
WORK=${1:?empty work dir}; SIZE=${2:-768}; HERE=$(cd "$(dirname "$0")" && pwd)
REPO_URL=https://github.com/ZhengPeng7/BiRefNet.git
REPO_COMMIT=97e4f35d74043427b0e9ba935ca10991853a36bc
PTH_URL=https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth
PTH_SHA256=6a1e050c6ec2697e5ed268455df544782b023acf8643ab771250979094875ab1
FP32_768_SHA256=c7e760a9a83d681be5787152d5009ebdd46d010e21e4df2b1b230f67e5b06ad4
INT8_768_SHA256=cb6edb75c5b4d1735f43881fb767eb59a59d3770336788b89eaebd8a5ff4e7fc
mkdir -p "$WORK"; cd "$WORK"
python3.12 -m venv venv && ./venv/bin/pip install -q -r "$HERE/requirements.lock.txt"
mkdir -p BiRefNet && (cd BiRefNet && git init -q && git fetch -q --depth 1 "$REPO_URL" "$REPO_COMMIT" && git checkout -q FETCH_HEAD)
curl -sL -o weights.pth "$PTH_URL"; echo "$PTH_SHA256  weights.pth" | shasum -a 256 -c -
./venv/bin/python "$HERE/export_birefnet.py" "$WORK/BiRefNet" "$WORK/weights.pth" "$SIZE" "$WORK/birefnet-lite-$SIZE-fp32.onnx"
./venv/bin/python "$HERE/shrink.py" "$WORK/birefnet-lite-$SIZE-fp32.onnx" "$WORK/birefnet-lite-$SIZE-int8.onnx"
for f in "birefnet-lite-$SIZE-fp32.onnx" "birefnet-lite-$SIZE-int8.onnx"; do shasum -a 256 "$f"; done
if [ "$SIZE" = 768 ]; then
  echo "$FP32_768_SHA256  birefnet-lite-768-fp32.onnx" | shasum -a 256 -c -
  echo "$INT8_768_SHA256  birefnet-lite-768-int8.onnx" | shasum -a 256 -c -
fi
