# Changelog

## [0.66.0-beta.1] - 2026-11-22

### Added

- Added a Full Changelog button to the Changelog.
- Added Changelog to the Help menu and Check for Updates to the app menu on macOS.

### Changed

- Changed sign-in encryption to an opt-in setting in Settings > Privacy; installs already using it keep it on.
- Changed backups to include server and scrobbling sign-ins only when Encrypt saved sign-ins is on.

### Fixed

- Fixed the app crash on macOS.
- Fixed opening Settings asking for the macOS login password.

## [0.65.0-beta.1] - 2026-11-22

### Added

- Added Back Up and Restore in Settings > Advanced Options.
- Added a Sign In button for servers that reject the saved sign-in.
- Added an Offline label for music folders that can't be read.
- Added Changelogs to the project and application.

### Security

- Encrypted saved server and scrobbling sign-ins with the system keyring.
- Changed playlist export to leave out server sign-ins unless you include them.

### Fixed

- Fixed scans failing or removing tracks when a music folder was offline.
- Fixed playlist and favourites imports matching the wrong Jellyfin or Emby track.
- Fixed playlists with server sign-ins not importing after signing in again.
- Fixed slow pausing while the window was minimized.
- Fixed the mute button having no screen reader label.

## [0.60.0-beta.1] - 2026-11-20

### Added

- Added Mood Analysis in Settings > Smart Recommendations, which scans local tracks and can use their lyrics.
- Added Smart Shuffle, which builds the queue from your listening history and track moods.
- Added a Listening history section in Settings > Smart Recommendations.
- Added a Mood row to Song Info.
- Added Recommendation data to the Factory Reset options.

### Changed

- Changed the shuffle button to cycle through off, shuffle and Smart Shuffle, with a right-click menu to pick one.

### Fixed

- Fixed the app sliding up under the title bar.
- Fixed the equalizer using processor time while playback was paused.

## [0.51.0-beta.2] - 2026-11-07

### Fixed

- Fixed sound briefly playing through the speakers when the audio device changed.
- Fixed Lyric Studio losing Ctrl+Z history after switching to the Sync tab and back.

## [0.51.0-beta.1] - 2026-11-07

### Added

- Added gapless playback between tracks.
- Added typo-tolerant search in library tables, Add Tracks and Vinyl Mode.
- Added switching the time-left label to the track length with a click.

### Changed

- Changed Jellyfin servers to list the app as XeroTunes.

### Security

- Blocked app windows from opening dropped files and links.
- Blocked server file names from saving outside the download folder.

### Fixed

- Fixed Discord presence showing the wrong elapsed time after reconnecting.
- Fixed lyrics not following playback after a gapless track change.

## [0.50.0-beta.1] - 2026-11-04

### Added

- Added Quality Check, which finds upscaled audio, clipping and cut-short or damaged tracks without changing your files.
- Added Quality report to the track right-click menu.
- Added a Compare button for same-song copies in Duplicate Tracks.

### Fixed

- Fixed library scans crashing on Linux while reading cover art.

## [0.48.5-beta.1] - 2026-11-01

### Added

- Added same-song detection to Duplicate Tracks, for tracks ripped twice with different audio.
- Added a Kept tab in Duplicate Tracks for groups you chose to keep, with Restore.
- Added a Show in file explorer button for each duplicate.

### Changed

- Changed Duplicate Tracks to compare audio, so MP3 tag edits no longer hide identical copies.
- Changed stored album art to at most 1200px, with the original size shown in the image preview.
- Changed the first scan after updating to take longer while it re-checks existing tracks.

## [0.48.0-beta.1] - 2026-10-23

### Added

- Added a Queue page, opened from the queue counter in the play bar.
- Added Play next and Add to queue to the track menu and the selection bar.
- Added a Show played option to the Queue page.

### Changed

- Changed the track notification to use a blurred window background on Windows 11 and macOS.

## [0.47.5-beta.1] - 2026-10-22

### Fixed

- Fixed removing a music folder deleting server tracks.
- Fixed server albums merging with local albums of the same name.
- Fixed the library not refreshing after some scans.

## [0.47.0-beta.1] - 2026-10-18

### Added

- Added a description, links and categories for installed .deb and .rpm copies in GNOME Software and Discover.

## [0.46.5-beta.1] - 2026-10-18

No changes in the app.

## [0.46.0-beta.1] - 2026-10-18

### Added

- Added update checks, with Check for updates in Settings > About and a Restart to update button in the title bar.
- Added updating through the system package manager for Linux .deb and .rpm installs.

## [0.45.0-beta.3] - 2026-10-18

No changes in the app.

## [0.45.0-beta.2] - 2026-10-18

### Fixed

- Fixed the disk icon shown when opening the macOS installer.

## [0.45.0-beta.1] - 2026-10-18

### Added

- Added an equalizer with 10 bands, presets and a bass boost.
- Added playback speed from 0.5x to 2x without changing the pitch.
- Added Copy info as to the track right-click menu.
- Added a volume percentage and mouse-wheel volume to Lyric Studio.

### Fixed

- Fixed Lyric Studio playing at full volume.

## [0.40.0-beta.1] - 2026-10-10

### Added

- Added Ambion (beta) in Settings, which plays surround sound through speakers you already own by adding a second device behind you.
- Added an Ambion Surround option to the audio output menu and Settings once Ambion is set up.
- Added a Sync with microphone option that times the delay between your speakers by listening to them.
- Added an Ambion mixer in the play bar with presets such as Concert Hall, Vocal Focus and Party Fill.

### Fixed

- Fixed the play bar hiding or showing itself when you reopened a list at a saved scroll position.
- Fixed the album header flickering between expanded and condensed when the album was too short to scroll.
- Fixed the last tracks of an album sitting behind the play bar.
- Fixed scrollbars in dialogs being cut off or misplaced.

## [0.35.0-beta.1] - 2026-09-20

### Added

- Added Vinyl Mode in the left menu, a turntable you can scratch by hand.
- Added a Start in Vinyl Mode switch in Settings to open on the turntable instead of the library.

## [0.32.2-beta.1] - 2026-09-15

### Fixed

- Fixed the title bar buttons not hiding when entering or leaving full screen on Windows.
- Fixed XeroTunes showing as a separate icon from its launcher on Linux.

## [0.32.0-beta.1] - 2026-09-12

### Added

- Added an Always show scrollbars switch in Settings > Display.

### Changed

- Changed scrollbars to a floating bar that fades out when you stop scrolling.
- Changed the About window on Linux to show the logo, website and author.
- Changed the title bar to hide its buttons in full screen.
- Changed the empty message for a radio station to take less space.

### Fixed

- Fixed F11 not toggling full screen on Windows and Linux.
- Fixed closing the window on macOS quitting the app instead of hiding it.
- Fixed shortcut hints on macOS showing ⌘ for shortcuts that use Control.
- Fixed the logo mark gradient on macOS.

## [0.30.0-beta.1] - 2026-09-09

### Added

- Added Lyric Studio, opened from Edit tags, to write lyrics for a track and sync them line by line.
- Added a right-click menu on tracks with Play next, Add to queue, Add to playlist, Add to favourites, Go to album, Go to artist, Edit tags and Show in file explorer.
- Added New playlist to the Add to playlist menus.
- Added saving lyrics beside the track or embedding them in the file.

### Changed

- Changed dialogs to keep their buttons in place at the bottom.
- Changed keyboard shortcut hints to show key caps.
- Changed the Back button to ask before leaving a screen with unsaved work.
- Changed the app icon on macOS.

## [0.25.0-beta.1] - 2026-09-06

### Added

- Added a menu bar on macOS with File, View, Playback, Window and Help menus.
- Added search, column choices, sorting and filtering to song lists, with a toolbar next to the page title.
- Added selecting tracks with checkboxes in album and artist pages, with a bar to play them or edit their tags.
- Added Rei, the mascot, to empty lists, and a recovery page for when something goes wrong.
- Added Rei to the About card in Settings.

### Changed

- Changed All Songs, Favourites, Recently Added, Genres and Years to use the new song lists.
- Changed Folder Hierarchy to open large folders faster.
- Changed the window zoom in Settings to follow the View menu.

### Fixed

- Fixed copy and paste not working on macOS.

## [0.20.0-beta.1] - 2026-09-05

### Added

- Added Music Sources in Settings to connect Jellyfin, Emby, Plex, Subsonic, Navidrome, Nextcloud, WebDAV and UPnP servers.
- Added a scan for servers on your network when adding a source.
- Added a choice of when to read tags from server files: while syncing, when a track plays, or never.
- Added a sync progress panel in Settings with a Cancel button.
- Added Download and Remove download for server tracks, and a download folder setting.
- Added lyrics from the server for streamed tracks.
- Added casting for tracks streamed from a server.
- Added a different folder colour for a server in Folder Hierarchy.
- Added a warning when closing the app while a scan or sync is running.

### Changed

- Changed Rescan and Full Rescan to include your servers as well as music folders.
- Changed the pointer to the regular arrow over buttons and links.
- Changed the album art preview to close when you click anywhere.
- Changed search and the Rescan buttons to wait while the library is busy.

### Fixed

- Fixed scans removing synced server tracks from the library.
- Fixed playback skipping through the queue with an error for each song when a server can't be reached.
- Fixed tracks left without an artist after a scan.

## [0.18.0-beta.1] - 2026-08-28

### Added

- Added a macOS installer for Intel Macs.

### Removed

- Removed the macOS ZIP download. Use the DMG instead.

## [0.17.0-beta.5] - 2026-08-22

No changes in the app.

## [0.17.0-beta.4] - 2026-08-22

No changes in the app.

## [0.17.0-beta.3] - 2026-08-22

No changes in the app.

## [0.17.0-beta.2] - 2026-08-22

No changes in the app.

## [0.17.0-beta.1] - 2026-08-22

### Added

- Added a Streams page for adding, importing, renaming and setting covers for internet radio streams.
- Added a Recently Played list to each radio station, with bookmarks for songs you want to keep.
- Added a setting in Settings > Streams for how long a station's recently played songs are kept.
- Added a tag editor for songs and albums, opened with Edit tags.
- Added a control to shift synced lyrics earlier or later.

### Changed

- Changed the window title to show the artist name.

### Fixed

- Fixed playback stalling at 0:00 on a damaged file instead of skipping to the next track.
- Fixed artist names being sent wrongly when scrobbling.

## [0.16.0-beta.1] - 2026-08-18

### Added

- Added scrobbling to Last.fm, Libre.fm, ListenBrainz, GNU FM and self-hosted servers in Settings.

## [0.15.0-beta.1] - 2026-08-16

### Added

- Added Playlists, with create, rename, delete, and import and export of M3U, PLS and XSPF files.
- Added a Favourites page with import and export.
- Added an Add songs dialog for filling a playlist from your library.
- Added a Favourites heart button to the play bar.

### Changed

- Changed the app logo on Windows and Linux.

### Fixed

- Fixed the installed app icon on Windows.

## [0.13.0-beta.1] - 2026-08-09

### Added

- Added custom colour themes: duplicate, edit, import and export them in Settings.
- Added Duplicate Tracks in Settings to remove extra copies of the same file.
- Added Factory Reset in Settings, with a choice of what to clear.
- Added editable artist-splitting rules with Apply to Library in Settings.
- Added Retry artists with no match in Settings.

### Fixed

- Fixed multi-artist tags being split into the wrong artists.
- Fixed removed songs leaving empty albums, artists and genres in the library.

## [0.12.0-beta.1] - 2026-07-30

### Added

- Added casting to Chromecast devices from the play bar.
- Added an audio output device picker.
- Added Pause on audio output change in Settings.
- Added Remember volume per device in Settings.
- Added artist name handling in Settings, with separators and exceptions for multi-artist tags.
- Added a ZIP download for Linux.

### Fixed

- Fixed audio output not being assigned correctly on Linux.

## [0.10.0-beta.2] - 2026-07-23

No changes in the app.

## [0.10.0-beta.1] - 2026-07-23

First beta release.

### Added

- Added a music library you can browse by songs, albums, artists, genres, years and folders.
- Added a Recently Added view and search.
- Added a mini player, which opens from a file's right-click menu on Windows.
- Added Discord presence for the track you're playing.
- Added a first-run setup for choosing your music folders.
- Added builds for Windows, macOS and Linux.
