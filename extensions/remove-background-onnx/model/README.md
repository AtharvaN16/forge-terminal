# The remove-background model

`birefnet-lite-768-int8.onnx`: BiRefNet-lite (Swin-tiny backbone, general use), exported at 768 × 768 pixels and compressed to int8. 54,465,081 bytes. It is not in the repository; `model.json` pins it by sha256 and names where it is hosted.

| | |
|---|---|
| sha256 | `cb6edb75c5b4d1735f43881fb767eb59a59d3770336788b89eaebd8a5ff4e7fc` |
| hosted at | `https://github.com/AtharvaN16/forge-terminal/releases/download/model-birefnet-lite-768-v1/birefnet-lite-768-int8.onnx` (a release whose only asset is this file) |
| licence | MIT (BiRefNet, Peng Zheng et al.; Swin Transformer, Microsoft). The training data is a set of public research datasets whose own terms were not reviewed; the extension's NOTICES.txt says so. |
| runs on | ONNX Runtime's CPU provider, **1.25.1 or newer**. Before 1.25.1 the CPU provider has no `DeformConv` and the model does not load (`Could not find an implementation for DeformConv(19)`). The extension uses `onnxruntime-node-rmbg`, an npm alias of onnxruntime-node 1.25.1. |
| memory | about 2.1–2.4 GB at its peak, about 1.4–2.8 s a photo on an Apple-silicon laptop |

## Hosting it

Upload the file under exactly this name to a release tagged `model-birefnet-lite-768-v1`. Nothing else goes in that release. `extensions/remove-background-onnx/build.mjs` downloads it from there (into `extensions/boost/.cache/`) and refuses anything whose sha256 is not the one in `model.json`. Build runs without the upload use `--onnx <local file>`, which is checked the same way.

## Building it

```bash
extensions/remove-background-onnx/model/build.sh /some/empty/folder        # 768
```

Python 3.12 and git. It downloads about 0.7 GB, needs about 3.7 GB of memory for the export and no GPU, and checks each result against the hashes below (it fails if one differs). Everything is pinned:

| What | Pin |
|---|---|
| source code | `github.com/ZhengPeng7/BiRefNet` at commit `97e4f35d74043427b0e9ba935ca10991853a36bc` (MIT) |
| weights | `BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth` from the project's v1 release, 177,791,685 bytes, sha256 `6a1e050c6ec2697e5ed268455df544782b023acf8643ab771250979094875ab1` |
| tools | Python 3.12, torch 2.14.1, torchvision 0.29.1, onnx 1.23.2, onnxruntime 1.31.0 and the rest in `requirements.lock.txt` |
| step 1 export | `export_birefnet.py`: opset 19, with torchvision's `deform_conv2d` written as ONNX's own `DeformConv`. `birefnet-lite-768-fp32.onnx`, sha256 `c7e760a9a83d681be5787152d5009ebdd46d010e21e4df2b1b230f67e5b06ad4` |
| step 2 shrink | `shrink.py`: drops the `Identity` nodes that only forward weights (so the quantiser can see them), quantises MatMul and Conv weights to int8, and stores the DeformConv weights as fp16 (cast back to fp32 on load). `birefnet-lite-768-int8.onnx`, sha256 `cb6edb75c5b4d1735f43881fb767eb59a59d3770336788b89eaebd8a5ff4e7fc` |

Two details matter, and both are in `shrink.py`: ONNX Runtime's own pre-optimiser is not used (it folds the small attention masks into about 70 MB of tables), and the `Identity` nodes go first (otherwise the weights behind them stay in float, 110 MB).

The same recipe at 512 pixels gives a 54 MB file that is faster (0.6 s, 1.3 GB) but misses subjects 768 finds: a bicycle against a graffiti door, people on chairs, a building, three people in a crowd.

## What the runner does with it

`mask.ts`: the photo is squashed to 768 × 768 (Lanczos), scaled by its brightest sample, normalised with ImageNet's mean (0.485, 0.456, 0.406) and deviation (0.229, 0.224, 0.225). The output is one 768 × 768 map of raw scores; a sigmoid turns it into 0–1, and it is enlarged to the photo (bilinear) as the alpha.

No subject: the top score is under 0.5, or fewer than 1% of the pixels are at 0.5 or more. On 42 test photos the top score was never between 0.01 and 0.98, so 0.5 is a safe middle; the smallest real subject covered 3.5% and a wall photo's specks 0.2%, so 1% is a safe middle there too.

## How it did

Against Apple Vision on 42 photos (people in patterned clothes, animals, products, glass, bicycles and chairs, signs, documents, landscapes, crowds, walls): the same subject or no-subject on 40, nothing found where Apple finds a subject on none, a cut-out where Apple finds none on two (a glass ball, a ploughed field). Full results: the round-3 results page (the project's mockups folder).
