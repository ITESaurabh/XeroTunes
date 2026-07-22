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

The workflow builds on Windows, macOS, and Linux and uploads installers to a
GitHub Release named after the tag.

## Secrets per channel

Channel-specific values live in two GitHub **Environments**, `beta` and
`production`. The release job selects one from the tag, so the same secret name
resolves to a different value per channel:

- `DISCORD_CLIENT_ID` — set once in each environment. Injected at build time via
  `dotenv-webpack` (`systemvars: true`), replacing the gitignored `.env.*` files
  that supply it locally.

`GITHUB_TOKEN` is provided automatically by Actions and is not per-channel.

## Auto-update

Not wired up yet — there's no code signing, and the app is beta-only for now.
Users update by downloading the latest installer from the GitHub Release.

## Local publishing

Publishing locally instead of via CI works too — `yarn publish` / `yarn
publish:prod` — but requires a `GITHUB_TOKEN` in your environment and only
builds for your current OS.
