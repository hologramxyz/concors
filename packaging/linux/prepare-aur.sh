#!/usr/bin/env bash
# Prepares the AUR copy of this package (concors-bin) for a desktop release that is already
# published on GitHub.
#
#   packaging/linux/prepare-aur.sh <version> <output-dir>
#
# Fills in real sha256 digests (the checked-in PKGBUILD says SKIP, since it is also used before
# the release exists), writes .SRCINFO, and builds the package from the published tarball exactly
# as an AUR user's makepkg would, so a PKGBUILD that cannot build never reaches the AUR. The output
# directory then holds the files the AUR repository carries; roll-out.yml pushes them.
#
# Needs makepkg and updpkgsums (pacman-contrib), so it runs in an `archlinux` container, and
# makepkg refuses to run as root: run it as an unprivileged user.
set -euo pipefail

version="${1:?usage: prepare-aur.sh <version> <output-dir>}"
output="${2:?missing output directory}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkgver="$(sed -n 's/^pkgver=//p' "$here/PKGBUILD")"
if [ "$pkgver" != "$version" ]; then
  echo "PKGBUILD pkgver is $pkgver, expected $version" >&2
  exit 1
fi

build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
cp "$here/PKGBUILD" "$here/concors.sh" "$here/concors.desktop" "$build/"
cd "$build"

# Downloads the published tarball and replaces each SKIP with its digest.
updpkgsums
if grep -q "'SKIP'" PKGBUILD; then
  echo "updpkgsums left a SKIP in the PKGBUILD" >&2
  exit 1
fi
makepkg --printsrcinfo > .SRCINFO

# --nodeps: the runtime dependencies are for the machine that installs the package, not this one.
makepkg --force --noconfirm --nodeps --nocheck
find . -maxdepth 1 -name 'concors-bin-*.pkg.tar.zst' | grep -q . || {
  echo "makepkg produced no package" >&2
  exit 1
}

mkdir -p "$output"
cp PKGBUILD .SRCINFO concors.sh concors.desktop "$output/"
echo "AUR files for concors-bin $version in $output"
