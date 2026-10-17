/**
 * Install scripts that add this channel's apt or dnf repo, so a hand-installed
 * .deb or .rpm keeps updating. Written to files because the makers take paths.
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
  const armored = fs.readFileSync(path.join(__dirname, 'key.asc'), 'utf8').trim();
  // Signed-By wants a binary keyring and gpg may be missing, so the postinst
  // base64-decodes the armor body: the only lines that are pure base64.
  const binary = armored
    .split(/\r?\n/)
    .filter(l => /^[A-Za-z0-9+/]+={0,2}$/.test(l))
    .join('\n');

  const scripts = {
    // Runs on upgrades too, so a release can move systems to a new repo address.
    postinst: `#!/bin/sh
set -e
if [ "$1" = configure ]; then
  base64 -d > /usr/share/keyrings/${name}.gpg <<'EOF'
${binary}
EOF
  cat > /etc/apt/${name}-mirrors.list <<'EOF'
${APT_MIRRORS.map((url, i) => `${url}\tpriority:${i + 1}`).join('\n')}
EOF
  cat > /etc/apt/sources.list.d/${name}.sources <<'EOF'
Types: deb
URIs: mirror+file:/etc/apt/${name}-mirrors.list
Suites: ./
Signed-By: /usr/share/keyrings/${name}.gpg
EOF
fi
`,
    postrm: `#!/bin/sh
set -e
if [ "$1" = purge ]; then
  rm -f /etc/apt/sources.list.d/${name}.sources /etc/apt/${name}-mirrors.list /usr/share/keyrings/${name}.gpg
fi
`,
    // No /etc/yum.repos.d means zypper (openSUSE): skip rather than fail.
    // skip_if_unavailable: RHEL 8's dnf fails every upgrade while a repo is down.
    post: `if [ -d /etc/yum.repos.d ]; then
  mkdir -p /etc/pki/rpm-gpg
  cat > /etc/pki/rpm-gpg/RPM-GPG-KEY-${name} <<'EOF'
${armored}
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
  rm -f /etc/yum.repos.d/${name}.repo /etc/pki/rpm-gpg/RPM-GPG-KEY-${name}
fi
`,
  };

  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, file), body);
}
