#!/bin/sh
# Builds Forge's own ffmpeg and ffprobe for Apple Silicon (video spec §3.7),
# from source, with only what Forge uses, and the source bundle the GPL asks
# to be published beside it.
#
#   sh extensions/video/build.sh <payload-dir> <source-dir>
#
# <payload-dir> receives:
#   ffmpeg, ffprobe   static except for macOS's own frameworks; ad-hoc signed
#   NOTICES.txt       the GPL, each component's licence, and where the source is
# <source-dir> receives:
#   forge-ext-video-<version>-source.tar.gz   every source tarball used, and this script
#
# Needs: Xcode's command-line tools, and nasm, pkg-config, autoconf, automake,
# libtool (CI installs them with Homebrew). Every download is checked against
# the sha256 pinned below before it is unpacked.
#
# Licence: ffmpeg is built with --enable-gpl (x264), so the binaries are
# GPL-2.0-or-later. Forge itself stays MIT: it only runs them as programs.
set -eu
[ $# -eq 2 ] || { echo "usage: build.sh <payload-dir> <source-dir>" >&2; exit 64; }

VERSION=1.0.0
MACOS_MIN=13.0
here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
srcout=$(mkdir -p "$2" && cd "$2" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
prefix="$work/prefix"
mkdir -p "$work/dl" "$work/build" "$prefix"
jobs=$(sysctl -n hw.ncpu)

export CFLAGS="-O2 -mmacosx-version-min=$MACOS_MIN"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-mmacosx-version-min=$MACOS_MIN"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"

# name|url|sha256
SOURCES='
ffmpeg-7.1.1.tar.xz|https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz|733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
x264-31e19f92.tar.bz2|https://code.videolan.org/videolan/x264/-/archive/31e19f92f00c7003fa115047ce50978bc98c3a0d/x264-31e19f92f00c7003fa115047ce50978bc98c3a0d.tar.bz2|01a4acb74eea1118c3aa96c3e18ee3384bc1f2bc670f31fb0f63be853e4d9d08
lame-3.100.tar.gz|https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz|ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e
opus-1.5.2.tar.gz|https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz|65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1
libogg-1.3.5.tar.gz|https://downloads.xiph.org/releases/ogg/libogg-1.3.5.tar.gz|0eb4b4b9420a0f51db142ba3f9c64b333f826532dc0f48c6410ae51f4799b664
libvorbis-1.3.7.tar.gz|https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.gz|0e982409a9c3fc82ee06e08205b1355e5c6aa4c36bca58146ef399621b0ce5ab
libvpx-1.15.0.tar.gz|https://github.com/webmproject/libvpx/archive/refs/tags/v1.15.0.tar.gz|e935eded7d81631a538bfae703fd1e293aad1c7fd3407ba00440c95105d2011e
zimg-3.0.5.tar.gz|https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.5.tar.gz|a9a0226bf85e0d83c41a8ebe4e3e690e1348682f6a2a7838f1b8cbff1b799bcf
'

fetch() {
  name=$1 url=$2 want=$3
  curl -fsSL --retry 3 -o "$work/dl/$name" "$url"
  got=$(shasum -a 256 "$work/dl/$name" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch for $name: got $got, want $want" >&2
    exit 1
  fi
}

unpack() {
  # unpack <tarball> → prints the directory it made
  dir="$work/build/${1%%.tar.*}"
  mkdir -p "$dir"
  tar -xf "$work/dl/$1" -C "$dir" --strip-components 1
  echo "$dir"
}

echo "$SOURCES" | while IFS='|' read -r name url sha; do
  [ -n "$name" ] || continue
  fetch "$name" "$url" "$sha"
done

static() { ./configure --prefix="$prefix" --disable-shared --enable-static "$@"; make -j"$jobs"; make install; }

( cd "$(unpack x264-31e19f92.tar.bz2)" && ./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli --disable-opencl && make -j"$jobs" && make install )
( cd "$(unpack lame-3.100.tar.gz)" && static --disable-frontend --disable-gtktest --disable-decoder )
( cd "$(unpack opus-1.5.2.tar.gz)" && static --disable-doc --disable-extra-programs )
( cd "$(unpack libogg-1.3.5.tar.gz)" && static )
# libvorbis 1.3.7's configure passes -force_cpusubtype_ALL on macOS, which
# today's Apple linker refuses ("unknown options"); it is dropped before configuring.
( cd "$(unpack libvorbis-1.3.7.tar.gz)" && sed -i '' 's/ -force_cpusubtype_ALL//g' configure &&
    static --disable-oggtest --with-ogg="$prefix" )
( cd "$(unpack libvpx-1.15.0.tar.gz)" && ./configure --prefix="$prefix" --disable-shared --enable-static \
    --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp9-highbitdepth \
    --extra-cflags="$CFLAGS" && make -j"$jobs" && make install )
( cd "$(unpack zimg-3.0.5.tar.gz)" && ./autogen.sh && static )

ff="$(unpack ffmpeg-7.1.1.tar.xz)"
(
  cd "$ff"
  ./configure \
    --prefix="$work/ffmpeg" \
    --pkg-config-flags=--static \
    --extra-cflags="$CFLAGS -I$prefix/include" \
    --extra-ldflags="$LDFLAGS -L$prefix/lib" \
    --enable-gpl \
    --disable-autodetect --disable-network --disable-ffplay --disable-doc --disable-debug \
    --enable-pthreads --enable-zlib \
    --enable-videotoolbox --enable-audiotoolbox \
    --enable-libx264 --enable-libmp3lame --enable-libopus --enable-libvorbis --enable-libvpx \
    --enable-libzimg
  make -j"$jobs"
  make install
)

for bin in ffmpeg ffprobe; do
  cp "$work/ffmpeg/bin/$bin" "$out/$bin"
  strip -x "$out/$bin"
  codesign --force --sign - "$out/$bin"
done

# The licence, and where the source of exactly these binaries is.
{
  cat <<N
Forge's video extension: FFmpeg 7.1.1 for macOS (Apple Silicon), built from
source by extensions/video/build.sh in the Forge repository.

These two programs are free software, licensed under the GNU General Public
License, version 2 or later (below). Forge runs them as separate programs; its
own code is MIT-licensed.

Source: the complete source of these binaries — every tarball below and the
build script — is published beside this download, as
forge-ext-video-$VERSION-source.tar.gz, on the Forge release that carries it:
https://github.com/AtharvaN16/forge-terminal/releases/tag/ext-video-v$VERSION

Built from:
  FFmpeg 7.1.1          GPL-2.0-or-later (with --enable-gpl)   https://ffmpeg.org
  x264 (31e19f92)       GPL-2.0-or-later                       https://www.videolan.org/developers/x264.html
  LAME 3.100            LGPL-2.0-or-later                      https://lame.sourceforge.io
  Opus 1.5.2            BSD-3-Clause                           https://opus-codec.org
  libogg 1.3.5          BSD-3-Clause                           https://xiph.org
  libvorbis 1.3.7       BSD-3-Clause                           https://xiph.org
  libvpx 1.15.0         BSD-3-Clause                           https://www.webmproject.org
  zimg 3.0.5            WTFPL                                  https://github.com/sekrit-twc/zimg

This software comes with no warranty, as the licence below says.

================================================================================
N
  cat "$ff/COPYING.GPLv2"
} > "$out/NOTICES.txt"

# The source bundle: every tarball as it was downloaded, and this script.
mkdir -p "$work/source/forge-ext-video-$VERSION-source"
cp "$work/dl/"* "$here/build.sh" "$work/source/forge-ext-video-$VERSION-source/"
tar -czf "$srcout/forge-ext-video-$VERSION-source.tar.gz" -C "$work/source" "forge-ext-video-$VERSION-source"

"$out/ffmpeg" -hide_banner -version | head -1
ls -la "$out" "$srcout"
