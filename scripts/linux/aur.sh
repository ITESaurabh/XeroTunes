#!/usr/bin/env bash
# Usage: scripts/linux/aur.sh <tag> <deb> <out-dir>
#
# Writes PKGBUILD and .SRCINFO for the AUR -bin package. Runs as root in archlinux:base-devel.
set -euo pipefail
tag=$1 deb=$2 out=$3

# An unmapped Debian dependency fails the release rather than being dropped.
declare -A ARCH=(
  [libc6]=glibc
  [libgtk-3-0]=gtk3
  [libnotify4]=libnotify
  [libnss3]=nss
  [xdg-utils]=xdg-utils
  [libatspi2.0-0]=at-spi2-core
  [libdrm2]=libdrm
  [libgbm1]=mesa
  [libxcb-dri3-0]=libxcb
  [libsecret-1-0]=libsecret
  [libglib2.0-bin]=glib2
)

control=$(bsdtar -xOf "$deb" 'control.tar.*' | bsdtar -xOf - ./control)
field() { sed -n "s/^$1: //p" <<< "$control"; }

depends=()
IFS=, read -ra groups <<< "$(field Depends | sed -E 's/ *\([^)]*\)//g; s/ //g')"
for group in "${groups[@]}"; do
  # Alternatives are one need spelled per distro; take the first Arch has.
  pick=
  IFS='|' read -ra alts <<< "$group"
  for alt in "${alts[@]}"; do
    if [[ -n ${ARCH[$alt]:-} ]]; then pick=${ARCH[$alt]}; break; fi
  done
  [[ -n $pick ]] || { echo "No Arch package for Debian dependency '$group'; add it to ARCH in $0." >&2; exit 1; }
  depends+=("$pick")
done

version=${tag#v}
mkdir -p "$out"
sed -e "s|@PKGNAME@|$(field Package)-bin|" \
    -e "s|@PKGVER@|${version//-/_}|" \
    -e "s|@TAG@|$tag|" \
    -e "s|@DEPENDS@|${depends[*]}|" \
    -e "s|@DEB@|$(basename "$deb")|" \
    -e "s|@SHA256@|$(sha256sum "$deb" | cut -d' ' -f1)|" \
    "$(dirname "$0")/PKGBUILD" > "$out/PKGBUILD"
# makepkg refuses to run as root, and wants to own the directory it reads.
tmp=$(mktemp -d)
cp "$out/PKGBUILD" "$tmp" && chown -R nobody "$tmp"
(cd "$tmp" && runuser -u nobody -- makepkg --printsrcinfo) > "$out/.SRCINFO"
