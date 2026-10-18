/**
 * Install scripts that add this channel's apt or dnf repo, so a hand-installed
 * .deb or .rpm keeps updating, and the AppStream metainfo that GNOME Software
 * and Discover show. Written to files because the makers take paths.
 */
import fs from 'fs';
import path from 'path';
import { CHANNEL, IDENTITY } from '../../src/config/channel';

// Order matters: apt shuffles a mirror list per machine unless lines carry the
// priority tags the postinst adds.
const APT_MIRRORS = [
  `https://xerotunes.com/apt/${CHANNEL}/`,
  `https://github.com/ITESaurabh/xerotunes-packages/releases/download/${CHANNEL}/`,
];
const RPM_MIRRORS = [
  `https://xerotunes.com/rpm/${CHANNEL}/`,
  `https://itesaurabh.github.io/xerotunes-packages/rpm/${CHANNEL}/`,
];

export function writeInstallScripts(dir: string): void {
  const name = IDENTITY.installName;
  const key = fs.readFileSync(path.join(__dirname, 'key.asc'), 'utf8').trim();

  // Neither maker can add files outside /usr/lib/<name>, so the scripts write it.
  // Not being in the payload, it's tied to the package by <pkgname> instead.
  const metainfoPath = `/usr/share/metainfo/${IDENTITY.appId}.metainfo.xml`;
  const writeMetainfo = `mkdir -p /usr/share/metainfo
  cat > ${metainfoPath} <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${IDENTITY.appId}</id>
  <pkgname>${name}</pkgname>
  <name>${IDENTITY.productName}</name>
  <summary>An open source cross platform music player application</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0-only</project_license>
  <developer id="com.itesaurabh">
    <name>ITESaurabh</name>
  </developer>
  <description>
    <p>XeroTunes is a feature rich, powerful, elegant music player for the personal music collection. Free, open source and can be used fully offline.</p>
  </description>
  <launchable type="desktop-id">${name}.desktop</launchable>
  <icon type="stock">${name}</icon>
  <url type="homepage">https://xerotunes.com</url>
  <url type="help">https://xerotunes.com/support</url>
  <url type="bugtracker">https://github.com/ITESaurabh/XeroTunes/issues</url>
  <url type="vcs-browser">https://github.com/ITESaurabh/XeroTunes</url>
  <url type="donation">https://github.com/sponsors/ITESaurabh</url>
  <categories>
    <category>AudioVideo</category>
    <category>Audio</category>
  </categories>
</component>
EOF`;

  const scripts = {
    // Runs on upgrades too, so a release can move systems to a new repo address.
    postinst: `#!/bin/sh
set -e
if [ "$1" = configure ]; then
  ${writeMetainfo}
  cat > /usr/share/keyrings/${name}.asc <<'EOF'
${key}
EOF
  cat > /etc/apt/${name}-mirrors.list <<'EOF'
${APT_MIRRORS.map((url, i) => `${url}\tpriority:${i + 1}`).join('\n')}
EOF
  cat > /etc/apt/sources.list.d/${name}.sources <<'EOF'
Types: deb
URIs: mirror+file:/etc/apt/${name}-mirrors.list
Suites: ./
Signed-By: /usr/share/keyrings/${name}.asc
EOF
fi
`,
    postrm: `#!/bin/sh
set -e
if [ "$1" = remove ] || [ "$1" = purge ]; then
  rm -f ${metainfoPath}
fi
if [ "$1" = purge ]; then
  rm -f /etc/apt/sources.list.d/${name}.sources /etc/apt/${name}-mirrors.list /usr/share/keyrings/${name}.asc
fi
`,
    // No /etc/yum.repos.d means zypper (openSUSE): skip rather than fail.
    // skip_if_unavailable: RHEL 8's dnf fails every upgrade while a repo is down.
    post: `${writeMetainfo}
if [ -d /etc/yum.repos.d ]; then
  mkdir -p /etc/pki/rpm-gpg
  cat > /etc/pki/rpm-gpg/RPM-GPG-KEY-${name} <<'EOF'
${key}
EOF
  cat > /etc/yum.repos.d/${name}.repo <<'EOF'
[${name}]
name=${IDENTITY.productName}
baseurl=${RPM_MIRRORS.join(' ')}
enabled=1
skip_if_unavailable=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-${name}
EOF
fi
`,
    postun: `if [ "$1" = 0 ]; then
  rm -f /etc/yum.repos.d/${name}.repo /etc/pki/rpm-gpg/RPM-GPG-KEY-${name} ${metainfoPath}
fi
`,
  };

  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, file), body);
}
