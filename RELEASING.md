# Releasing

Releases are built and published to GitHub Releases by the
[`release`](.github/workflows/release.yml) workflow, triggered on tag push.

## Channels

The app ships two channels (see [src/config/channel.ts](src/config/channel.ts)).
The tag shape picks the channel:

| Tag              | Channel | Result                              |
| ---------------- | ------- | ----------------------------------- |
| `v0.10.0`        | stable  | full release, `yarn publish:prod`   |
| `v0.10.0-beta.1` | beta    | prerelease, `yarn publish`          |

A tag containing a hyphen is treated as a prerelease.

Each channel's tag must be on its branch — stable on `main`, beta on
`development`. A tag on the wrong branch fails the guard job before any build
runs.

## Cutting a release

The tag is authoritative: CI sets the build version from it (`npm version` in the
workflow), so the release always matches the tag. No need to bump `package.json`
first — though keeping it roughly in sync is fine for local dev.

```
git tag v0.10.0            # stable, from main
git tag v0.10.0-beta.1     # beta, from development
git push origin v0.10.0
```

The workflow builds on Windows, Linux, and both macOS architectures (arm64 and
x64) and uploads installers to a GitHub Release named after the tag.

The Intel build runs natively on `macos-26-intel`. There is no automatic
fallback: if GitHub retires that image the release fails on that job, on
purpose. A cross-compiled x64 binary that nobody ran is worse than a build you
can see is broken.

To cross-compile anyway -- retired image, or you just need the artifact --
the workflow carries a commented-out block for it: comment the `macos-26-intel`
matrix entry, uncomment the `macos-latest` one below it, and uncomment the
matching `run:` line on the Publish step. Test the result on a real Intel Mac
before it goes to a stable tag; the runner cannot do that for you.

## Secrets per channel

Channel-specific values live in two GitHub **Environments**, `beta` and
`production`. The release job selects one from the tag, so the same secret name
resolves to a different value per channel:

- `DISCORD_CLIENT_ID` — set once in each environment. Injected at build time via
  `dotenv-webpack` (`systemvars: true`), replacing the gitignored `.env.*` files
  that supply it locally.

`GITHUB_TOKEN` is provided automatically by Actions and is not per-channel.

The Linux repos add `LINUX_REPO_GPG_KEY`, `LINUX_REPO_GPG_PASSPHRASE`,
`PACKAGES_REPO_TOKEN` and `AUR_SSH_KEY`, set to the same values in both
environments; see [Linux one-time setup](#linux-one-time-setup).

## Updates

Windows and macOS: not wired up yet. Users download the latest installer from
the GitHub Release.

Linux: installing the `.deb` or `.rpm` adds the channel's apt or dnf repo, so
new versions arrive with system updates. Arch has `xerotunes-bin` and
`xerotunes-beta-bin` on the AUR. The `linux-repos` job publishes all three
after the `release` job has uploaded the installers.

### Linux repo layout

| Channel | apt | dnf | AUR |
| ------- | --- | --- | --- |
| stable | `https://xerotunes.com/apt/stable/` | `https://xerotunes.com/rpm/stable/` | `xerotunes-bin` |
| beta | `https://xerotunes.com/apt/beta/` | `https://xerotunes.com/rpm/beta/` | `xerotunes-beta-bin` |

xerotunes.com stores nothing. Netlify answers `/apt/*` and `/rpm/*` with a 302
to [ITESaurabh/xerotunes-packages](https://github.com/ITESaurabh/xerotunes-packages),
which only CI writes to:

- **apt:** releases named `stable` and `beta` in that repo hold a flat repo
  (`Packages`, `Packages.gz`, `Release`, `InRelease`, `Release.gpg`) and a copy
  of the `.deb`. apt fetches the package relative to the index, so the copy has
  to sit next to it.
- **dnf:** GitHub Pages serves `rpm/<channel>/repodata/`. The index points at
  the `.rpm` in this repo's versioned release, so nothing is copied. It's on
  Pages because dnf needs a `repodata/` directory, and release asset names
  can't contain slashes.

The packages live in a separate repo because fixed `stable` and `beta`
releases here would always be the newest, and GitHub would mark them "latest",
breaking the README's download link and the website's download buttons.

Every system gets both addresses: apt through a mirror list
(`/etc/apt/<name>-mirrors.list`), dnf through two `baseurl`s. When
xerotunes.com refuses the connection or returns 404, both fall back to the
GitHub address. A bad signature is different: apt and dnf refuse the index and
don't try the second address, so a hijacked domain stops updates instead of
serving bad ones.

[scripts/linux/installScripts.ts](scripts/linux/installScripts.ts) writes the
key, repo file and mirror list on every install and upgrade, not only the
first. The README's terminal install commands write the same files with only
the xerotunes.com address; the package replaces them when it installs. To move
systems to a new address, release a version with the new URLs there and change
the README commands to match. Systems upgrade to it from the old address and
use the new one from then on. Purging the `.deb` or removing the `.rpm` deletes
those files. The key dnf imported into the rpm database stays
(`rpm -q gpg-pubkey`).

The packages declare the glibc floor from
[src/config/osFloor.ts](src/config/osFloor.ts). When a release raises it, apt
keeps the package back and dnf won't install it, so older systems stay on the
last version that runs.

openSUSE installs the `.rpm` but gets no repo: zypper reads
`/etc/zypp/repos.d`, which the `%post` doesn't write.

### Signing

One RSA 4096 key signs the apt `InRelease` and `Release.gpg`, dnf's
`repomd.xml.asc`, and every `.rpm` (rpmsign in `forge.config.ts`'s `postMake`,
CI only). RSA was tested against RHEL 8's rpm 4.14; EdDSA was not. The public
half is [scripts/linux/key.asc](scripts/linux/key.asc), built into the install
scripts and copied to `https://itesaurabh.github.io/xerotunes-packages/key.asc`,
where the README's install commands fetch it through
`https://xerotunes.com/linux/key.asc`.

Keep the private key backed up offline. Systems trust only the key their
package installed. A release signed with the old key can ship a new one, but
if the old key is lost, every user has to reinstall by hand.

### Linux one-time setup

1. Create the key on any machine with GnuPG 2.2 or newer, and set a
   passphrase when asked:

   ```
   gpg --quick-gen-key 'XeroTunes Linux Repository <itesaurabh@yahoo.com>' rsa4096 sign never
   gpg --armor --export 'XeroTunes Linux Repository' > scripts/linux/key.asc
   gpg --armor --export-secret-keys 'XeroTunes Linux Repository' > private.asc
   ```

   Commit `scripts/linux/key.asc`. In both environments, add
   `LINUX_REPO_GPG_KEY` (the contents of `private.asc`) and
   `LINUX_REPO_GPG_PASSPHRASE`. Delete `private.asc` once it's backed up.
2. Create the public repo `ITESaurabh/xerotunes-packages` with a README (an
   empty repo can't hold releases). Under **Settings > Pages**, deploy from the
   `main` branch, root folder. Create a fine-grained token for that repo only,
   with **Contents: Read and write**, and add it to both environments as
   `PACKAGES_REPO_TOKEN`. The workflow's `GITHUB_TOKEN` can't write to another
   repo.
3. Create an AUR account, add an SSH public key under **My Account**, and add
   the private key to both environments as `AUR_SSH_KEY`. The first release on
   each channel creates its AUR package.
4. Add to the site's `_redirects`:

   ```
   /apt/stable/*   https://github.com/ITESaurabh/xerotunes-packages/releases/download/stable/:splat  302
   /apt/beta/*     https://github.com/ITESaurabh/xerotunes-packages/releases/download/beta/:splat    302
   /rpm/*          https://itesaurabh.github.io/xerotunes-packages/rpm/:splat                         302
   /linux/key.asc  https://itesaurabh.github.io/xerotunes-packages/key.asc                            302
   ```

   The README's install commands fetch the key through the last line.

Until steps 1 to 3 are done, Linux releases fail: `yarn make` on Linux reads
`scripts/linux/key.asc`, and the Linux build and `linux-repos` job read the
secrets.

### Testing a repo change

Build in the CI image (`quay.io/pypa/manylinux_2_28_x86_64`) with a throwaway
key and two versions, serve the output of `scripts/linux/repo.sh` with
`python3 -m http.server`, and point the URLs in
`scripts/linux/installScripts.ts` at it for that build only. Give the two
mirrors different IP addresses (for example `127.0.0.1` and `127.0.0.2`): apt
remembers an address that refused a connection, port aside, and skips it for
the next mirror too, which makes the fallback look broken when it isn't.

## Local publishing

Publishing locally instead of via CI works too — `yarn publish` / `yarn
publish:prod` — but requires a `GITHUB_TOKEN` in your environment and only
builds for your current OS.
