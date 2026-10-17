#!/usr/bin/env bash
# Usage: scripts/linux/repo.sh <channel> <rpm-base-url> <packages-dir> <out-dir>
#
# Signs indexes for the .deb and .rpm in packages-dir with gpg's default key:
#   out/apt/  flat repo plus a copy of the .deb, which apt fetches next to the index
#   out/rpm/  repodata/ only; dnf fetches the .rpm from rpm-base-url
# Needs apt-utils, createrepo_c and gpg.
set -euo pipefail
channel=$1 rpm_url=$2 in=$(realpath "$3")
mkdir -p "$4/apt" "$4/rpm"
out=$(realpath "$4")

cd "$out/apt"
cp "$in"/*.deb .
apt-ftparchive packages . > Packages
gzip -9nkf Packages
# Release hashes every index in the directory, so it is written outside first.
# apt asks before accepting a changed Origin or Label: never change them.
apt-ftparchive release . \
  -o APT::FTPArchive::Release::Origin=XeroTunes \
  -o APT::FTPArchive::Release::Label=XeroTunes \
  -o APT::FTPArchive::Release::Suite="$channel" > "$out/Release"
mv "$out/Release" Release
gpg --batch --yes --clearsign -o InRelease Release
gpg --batch --yes --armor --detach-sign -o Release.gpg Release

createrepo_c --baseurl "$rpm_url" --outputdir "$out/rpm" "$in"
gpg --batch --yes --armor --detach-sign -o "$out/rpm/repodata/repomd.xml.asc" "$out/rpm/repodata/repomd.xml"
