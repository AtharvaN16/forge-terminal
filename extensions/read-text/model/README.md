# The read-text models

One detector and six recognisers, which together read the scripts Apple Vision reads on a Mac: Latin (many languages), Chinese (simplified and traditional), Japanese, Korean, Cyrillic, Arabic, Devanagari and Thai. None of them is in the repository; `../model.json` pins every file by sha256.

| Recogniser | Reads | PaddlePaddle's file | Shipped (half precision) | sha256 of the shipped file |
|---|---|---|---|---|
| `rec-main.onnx` | Latin (many languages), Chinese (simplified and traditional), Japanese | 21.2 MB | 10.6 MB | `3d842c0dd3eaf40f29750e52c7c023a4e3a622f8dd48cb09336fd59e8093b3fc` |
| `rec-korean.onnx` | Korean | 13.4 MB | 6.8 MB | `7a34f0b0dab9e8105b74b74976fb4ceef0022e1151d4176d24cdd1e0d3343ff2` |
| `rec-cyrillic.onnx` | Russian, Ukrainian and other Cyrillic | 8.0 MB | 4.1 MB | `5f8bb82a615bf012cbe28aed5e6c8ce64667a5951582c96d35b2e8c0e8c53e6b` |
| `rec-arabic.onnx` | Arabic | 8.0 MB | 4.1 MB | `f20b2a91160dca03cbcc04ea55a129a9fd2dcb09503f60a331b10c8fadc41704` |
| `rec-devanagari.onnx` | Hindi, Marathi and other Devanagari | 7.9 MB | 4.0 MB | `8e3196d9e89b920db845582d3d743af8fd0537bf632f07034ad03d0f0c02f7a3` |
| `rec-thai.onnx` | Thai | 7.9 MB | 4.0 MB | `245e99be807e0c9974028f075970b18fe115a049a6b6891187739a98e8249173` |

- **Detector** `det.onnx`: PP-OCRv4 mobile (RapidOCR's export), 4.7 MB, unchanged. Four detectors were tried (v4, v5 mobile, v6 small, v6 tiny) on clean and photographed pages; they read alike, and v4, the one already shipped, was best or level on average.
- **Recognisers** come from PaddlePaddle's own `*_onnx` repositories on Hugging Face (Apache-2.0), at the commit pinned in `model.json`. `main` is PP-OCRv6 small (21 MB, 5.2 M parameters), which reads Latin, Chinese and Japanese in one model; the other five are PP-OCRv5 mobile. Each model's dictionary is read from its own `inference.yml` (also pinned) when the extension is built.
- **Half precision** (`pack.py`): the weights are stored as float16 and widened to float32 when the model loads. The graph and every value it computes with are the same; on 28 test pages (14 clean, 14 photographed) it read exactly as the originals do, and the files are half the size (66 MB of recognisers become 34 MB). Quantising to int8 instead was tried and rejected: 3x smaller, but about 40% more errors (Korean went from 0.2% to 3.0%).

## Rebuilding the shipped files

```bash
extensions/read-text/model/build.sh /some/empty/folder
```

Python 3.12. It downloads PaddlePaddle's files, checks each against `model.json` (`source`), packs them, and fails unless every result has the pinned sha256 (`onnx`). Tools are pinned in `requirements.txt` (numpy 2.4.6, onnx 1.23.2, protobuf 7.36.2); run twice from scratch, it makes the same bytes.

## Hosting

Upload the six `rec-<id>.onnx` files, under exactly those names, to a release tagged `model-read-text-scripts-v1` (nothing else in it). `extensions/read-text/build.mjs` downloads them from there (into `extensions/boost/.cache/`) and refuses any file whose sha256 is not the pinned one. A build without the upload uses `--models <folder>` (the `recognisers` folder `build.sh` makes), checked the same way.

## Which recogniser reads a page

`runner.ts` (`readCrops`): nothing is asked of the user and nothing is guessed from a file's name or the system's language. The main recogniser reads the page's widest lines; if it is sure (0.96 on average: Latin, Chinese and Japanese read at 0.99) the page is its own. If not, the other five read the same lines and the surest takes the page. Cyrillic is asked on every page, since a recogniser for Latin reads Cyrillic in lookalike letters (`ABTOMO-` for `автомо-`) and is sure of itself (0.91 on average). Then each line is read by the page's recogniser, and a line it is not sure of (under 0.93, at most 60 per page) is shown to the others: another reading takes it if it is surer and the page's recogniser has no letter for something in it, or if the page's reading is poor (under 0.7). That is what reads a sign in Korean, Japanese and English line by line. Only the recognisers a page needs are loaded.

Arabic comes out of its model in the order it is drawn, left to right; `drawnToLogical` reverses it as PaddleOCR does (character error 81% before, 3% after).

## Known gaps against Apple Vision

- **Vietnamese**: the dictionaries have no letters for most doubly-marked vowels (ạ ả ậ ầ ấ ẩ ẫ ắ ằ ặ ẹ ẻ ế ề ệ ị ọ ộ ố ợ ụ ự ử ỳ ỷ…), so they are left out: 15% of characters wrong on a test page, where Vision has none.
- **Greek** is not read well (50% on a test page) and is not on Vision's list either.
- **Vertical text** (old Chinese and Japanese newspapers) is not read; Vision reads it.
- **Arabic and Devanagari** marks (vowel signs on Arabic, some conjuncts) are dropped now and then: 3% and 2% on test pages, Vision 0%.
