# usage: build.py <out dir>
#
# Makes the recognisers the extension ships, from PaddlePaddle's own ONNX files:
# downloads each one (model.json "source"), checks its sha256, stores its weights
# in half precision (pack.py), and checks the result against the sha256 the
# extension pins ("onnx"). It stops at the first difference.
import hashlib
import json
import os
import sys
import urllib.request

import pack

HERE = os.path.dirname(os.path.abspath(__file__))
model = json.load(open(os.path.join(HERE, "..", "model.json"), encoding="utf8"))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


for rec in model["recognisers"]:
    original = os.path.join(out, f"source-{rec['id']}.onnx")
    packed = os.path.join(out, f"rec-{rec['id']}.onnx")
    urllib.request.urlretrieve(rec["source"]["url"], original)
    if sha256(original) != rec["source"]["sha256"]:
        sys.exit(f"{rec['id']}: the download is not the pinned file ({rec['source']['url']})")
    pack.main(original, packed)
    if sha256(packed) != rec["onnx"]["sha256"]:
        sys.exit(f"{rec['id']}: packed file differs from model.json ({sha256(packed)})")
    print(f"{rec['id']}: {os.path.getsize(original)} -> {os.path.getsize(packed)} bytes, sha256 matches")
