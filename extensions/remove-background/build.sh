#!/bin/sh
# Build the universal (arm64 + x86_64) forge-cutout helper into <outdir>.
# usage: extensions/remove-background/build.sh <outdir>
set -eu
[ $# -eq 1 ] || { echo "usage: build.sh <outdir>" >&2; exit 64; }
here=$(cd "$(dirname "$0")" && pwd)
out=$1
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos14.0" "$here/forge-cutout.swift" -o "$tmp/forge-cutout-$arch"
done
lipo -create "$tmp/forge-cutout-arm64" "$tmp/forge-cutout-x86_64" -output "$out/forge-cutout"
codesign --force --sign - "$out/forge-cutout"
cat > "$out/NOTICES.txt" <<'N'
forge-cutout is original Forge code. It calls Apple's Vision framework
(VNGenerateForegroundInstanceMaskRequest), which ships with macOS; no third-party
code or model is bundled.
N
