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

1. Bump `version` in `package.json` and commit.
2. Tag and push:
   ```
   git tag v0.10.0        # or v0.10.0-beta.1 for beta
   git push origin v0.10.0
   ```
3. The workflow builds on Windows, macOS, and Linux and uploads installers to a
   GitHub Release matching the tag.

## Required repository secret

- `DISCORD_CLIENT_ID` — injected at build time via `dotenv-webpack`
  (`systemvars: true`), replacing the gitignored `.env.*` files that supply it
  locally. `GITHUB_TOKEN` is provided automatically by Actions.

## Auto-update

Not wired up yet — there's no code signing, and the app is beta-only for now.
Users update by downloading the latest installer from the GitHub Release.

## Local publishing

Publishing locally instead of via CI works too — `yarn publish` / `yarn
publish:prod` — but requires a `GITHUB_TOKEN` in your environment and only
builds for your current OS.
