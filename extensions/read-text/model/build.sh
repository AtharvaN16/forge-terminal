#!/bin/bash
# Rebuilds the read-text recognisers from PaddlePaddle's own files and checks
# every one against the sha256 in ../model.json.
#
#   usage: build.sh <empty work dir>
#
# Needs python3.12. Downloads about 100 MB and needs under 1 GB of memory.
set -euo pipefail
WORK=${1:?empty work dir}; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$WORK"
python3.12 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q -r "$HERE/requirements.txt"
cd "$HERE" && "$WORK/venv/bin/python" build.py "$WORK/recognisers"
