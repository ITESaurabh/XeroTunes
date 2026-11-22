# Agent instructions

Run `yarn lint`, `yarn typecheck` and `yarn test` before calling work done.

## Constraints the code doesn't show

- A new setting needs a value in `DEFAULT_APP_SETTINGS`. Restoring a backup drops
  any key without one.
- There is no migration tool. A new column gets a `table_info` check and an
  `ALTER TABLE` in the migrations block of `mainProcess.ts`, so existing
  libraries keep working.
- Saved sign-ins go through `sealSecret` / `openSecret`
  ([src/main/utils/secrets.ts](src/main/utils/secrets.ts)). A new kind of saved
  sign-in also needs adding to
  [SignInProtection.ts](src/main/modules/SignInProtection.ts), so turning
  Encrypt saved sign-ins on or off reseals it.
- Don't call `safeStorage` outside secrets.ts. On an unsigned macOS build,
  reading the key asks for the login password, so that may only happen after the
  user turns on Encrypt saved sign-ins.
- Chromium runs a hidden, silent window's timers about once a second. Anything
  that runs while the app is minimised measures elapsed time; it doesn't count
  ticks.
- The Essentia mood models are CC BY-NC-SA: the app downloads them and must never
  bundle them. Don't add essentia.js (AGPL).
- There is no code signing on Windows or macOS. Don't plan work that needs it.
- Don't add a dependency without asking.
- `node_modules/better-sqlite3` is built for Electron, so plain Node scripts
  can't load it. Use `node:sqlite` or the `sqlite3` CLI.
- Don't set `DEBUG` when running Forge. dotenv-webpack bakes it into the bundle
  and webpack fails with `Assigning to rvalue`.

## Conventions

- Several files don't match `.prettierrc.json`. Format the lines you change, not
  the whole file.
- Comments say why, not what, and only where they earn it: a gotcha, a
  workaround, a constraint. `ponytail:` comments mark a known shortcut, its
  limit and the fix.
- Colours come from the theme palette, not hex values. Vinyl Mode is the
  exception.
- The app is touch-first: every tappable or draggable control needs a hit area
  of at least 44px. No `size="small"` IconButtons on touch surfaces.
- Don't resize a MUI `Button` on one screen. Size changes go in the `MuiButton`
  override in [src/config/theme.ts](src/config/theme.ts).
- Page toolbars: secondary actions are `IconButton`s in a `<Tooltip>` with a
  `<span>` wrapper; a text `Button` is only for the page's main action. On/off
  options are `XTSwitch` in a `FormControlLabel` with `sx={{ m: 0, gap: 1.5 }}`.
- PlayBar holds no state that changes every tick. Read the playback position in
  a memoised child, as `PlaybackProgress` does, or use PlayBar's 1 s interval.
  Styles on those paths are module-level `styled()` components, not inline `sx`.
- The store's queue holds slim `QueueTrack`s. Don't add a full `Track[]` copy;
  a field PlayBar needs from `state.track` goes in `PLAYBACK_FIELDS`.
- Logic with branches or loops gets a self-check (`*.check.ts` or `test_*.js`).
  Put that logic in a module the check can import without Electron. The scan
  worker can't load under plain Node, so scan logic goes in `libraryRules.js`.
  Don't add a test framework.
- Test fixtures use made-up names ("Test Artist", "Song A"), never real artists,
  titles, albums or lyrics. AC/DC is the one allowed exception.

## Dev server

- The owner usually has `yarn start` running, and every save reloads the window.
  Keep each save runnable: add an export before the code that uses it, and add a
  new prop as optional before callers pass it.
- Check ports 3456 and 9222 before starting the app. If the owner's app holds
  them, don't start a second one (it deletes the running app's `.webpack/`
  output) and don't drive 9222, which is their live window.
- From a shell, start it with `NODE_ENV=development yarn start`, or better-sqlite3
  gets bundled and the app fails to load it.
- Restore and factory reset relaunch the app. Under `yarn start` that ends Forge
  and leaves an Electron with no dev server; kill it and start again.

## Driving the app over DevTools

The dev build listens for DevTools on port 9222.

- The play bar's transport controls ignore `.click()`. Dispatch `pointerdown`,
  `mousedown`, `pointerup`, `mouseup`, `click`.
- A MUI `IconButton` in a `Tooltip` shares its `aria-label` with the wrapper
  span, which comes first. Select `button[aria-label=…]`.
- Setting `location.hash` to a route that doesn't exist loops the router and
  unmounts the player. `#/main_window` is safe.
- Don't call `captureStream()` on an audio element. Chromium feeds only the
  newest capture, so a probe starves the surround engine.

## Git

- Don't commit, stage, unstage or stash unless asked. The owner stages a
  baseline and diffs your work against it.
- Commit titles are short and lowercase ("fade fix"), with no Co-Authored-By or
  AI attribution lines.

## Changelog

Any change a person using the app can notice gets a line under
`## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), in the same piece of work as
the code; add that heading above the newest release if it's missing. Write it as
[RELEASING.md § Changelog](RELEASING.md#changelog) says.

- If the work changes something already under Unreleased, edit that line. A fix
  to an unreleased feature gets no Fixed entry.
- Leave out refactors, tests, docs, build and CI changes.
- Don't touch a release section once its tag exists (`git tag -l 'v*'`).
