#!/usr/bin/env bash
# Builds the Arch package from an already-built release tarball.
#
#   packaging/linux/build-package.sh <tarball> <version> <output-dir>
#
# The tarball is not compiled here — `package()` only restages its tree — so this runs on any
# machine with makepkg, including an `archlinux` container in CI holding an artifact built on
# Ubuntu. The checked-in PKGBUILD carries the current pkgver; this script asserts the two agree
# rather than rewriting it, so the repository stays the single source of that number.
#
# makepkg refuses to run as root. In a container, run it as an unprivileged user.
set -euo pipefail

tarball="${1:?usage: build-package.sh <tarball> <version> <output-dir>}"
version="${2:?missing version}"
output="${3:?missing output directory}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$tarball" ] || { echo "No such tarball: $tarball" >&2; exit 1; }

pkgver="$(sed -n 's/^pkgver=//p' "$here/PKGBUILD")"
if [ "$pkgver" != "$version" ]; then
  echo "PKGBUILD pkgver is $pkgver, expected $version" >&2
  exit 1
fi

build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
cp "$here/PKGBUILD" "$here/concors.sh" "$here/concors.desktop" "$build/"
cp "$tarball" "$build/Concors-${version}-x64.tar.gz"

# --nodeps: the runtime dependencies are for the machine that installs the package, not this one.
( cd "$build" && makepkg --force --noconfirm --nodeps --nocheck )

mkdir -p "$output"
package="$(find "$build" -maxdepth 1 -name '*.pkg.tar.zst' -print -quit)"
[ -n "$package" ] || { echo "makepkg produced no package" >&2; exit 1; }
cp "$package" "$output/"
echo "$output/$(basename "$package")"
