<p align="center">
  <img src="src/assets/logo/XeroTunesLogo@2x.png" alt="XeroTunes logo" width="128">
</p>

<h1 align="center">XeroTunes</h1>

<p align="center">
  XeroTunes is a feature rich, powerful, elegant music player for the personal music collection. Free, open source and can be used fully offline.
</p>

<p align="center">
  <a href="https://xerotunes.com"><b>Website</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ITESaurabh/XeroTunes/releases/latest"><b>Download</b></a>
  &nbsp;·&nbsp;
  <a href="https://xerotunes.com/support">Help &amp; FAQ</a>
  &nbsp;·&nbsp;
  <a href="https://discord.gg/DaKyJ3q9rF">Discord</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ITESaurabh/XeroTunes/issues">Report a problem</a>
</p>


## Why XeroTunes

### 📃 Lyric Studio
A professional grade interface for Add/Edit & Sync song lyric right from the app! you can even export it into an .LRC file.  

### 🎮 Discord Presence
Now you can show your Friends what you're playing, just like Spotify, but for music you own!

### 🔊 XT Ambion surround <sup>beta</sup>
Get decent surround sound without wasting money. by putting your extra speaker to work!

### 💿 Vinyl Mode
Your personal Zen mode so nothing comes b/w you and your music experince (not even XeroTunes itself lol). Simulates a vinly player as faithfully as possible. 

### 💻 Fully Cross-Platform
The same look and behaviour on every Operating system. So you can feel at home everytime. we love them all equally!.

### 📚 Everything in one place
You can easily use your local music collection or your Remote servers like (Jellyfin, Plex, UPnP and so many more.) or even all of them at once!

## Also included

- **Private**: no account, and nothing leaves your computer unless you turn on scrobbling or Discord
- **Plays** MP3, FLAC, WAV, OGG, Opus, M4A/AAC and WebM
- **Browse** by album, artist, genre, year or folder, and search everything
- **Playlists** and favourites, with M3U, PLS and XSPF import and export
- **Servers**: Jellyfin, Emby, Plex, Subsonic/Navidrome, Nextcloud, WebDAV, UPnP/DLNA
- **Lyrics** from a `.lrc` file, the song itself, or your server
- **Tag editor** for titles, artists, albums and cover art
- **Duplicate finder** for identical files
- **Cast** to Chromecast and Google speakers
- **Scrobbling** to Last.fm, Libre.fm and ListenBrainz
- **Equalizer**: 10 bands, with presets like Bass boost, Vocal and Rock
- **Tempo**: speed songs up or slow them down without changing the pitch
- **Themes**: light, dark, or make your own
- **Mini player** (Windows): right-click a song and choose *Open with XeroTunes*

## Download and install

Get the latest version from the
[Releases page](https://github.com/ITESaurabh/XeroTunes/releases/latest).
Pick the file for your computer:

| Your computer | File to download |
|---|---|
| Windows 10 or 11 | the `Setup.exe` file |
| Mac with Apple chip (M1 or newer) | the `.dmg` file |
| Mac with Intel chip | the `.dmg` file marked `x64` or `Intel` |
| Ubuntu, Debian, Linux Mint, Pop!_OS | the `.deb` file |
| Fedora, openSUSE, RHEL | the `.rpm` file |

Not sure which Mac you have? Open the Apple menu and choose **About This Mac**.
The line called *Chip* or *Processor* tells you.

### "Windows protected your PC" or "Apple could not verify" warnings

XeroTunes isn't code-signed yet, so your computer doesn't recognise the
publisher and shows a warning the first time you open it. The app is safe to
run, and the source code is all in this repository.

[Sponsor](https://github.com/sponsors/ITESaurabh) or
[donate](https://xerotunes.com/#support) to help: the money goes to developer
account fees and signing certificates only then for rest of the developement work.

- **Windows:** click **More info**, then **Run anyway**.
- **macOS:** open the app once and close the warning. Then go to **System
  Settings → Privacy & Security**, scroll down, and click **Open Anyway** next
  to the XeroTunes message. The website has a
  [step-by-step guide](https://xerotunes.com/blog/macos-first-launch).

<details>
<summary>macOS says the app "is damaged and can't be opened"</summary>

Open the **Terminal** app, paste this line and press Return:

```
xattr -cr /Applications/XeroTunes*.app
```

Then open XeroTunes again. This removes the "downloaded from the internet" flag
that macOS attaches to unsigned apps.
</details>

### Linux

Builds are for 64-bit Intel/AMD computers only. You need Ubuntu 20.04, Debian
10, Fedora 29 or newer. Requirements for every system are on the
[website](https://xerotunes.com/support#requirements).

## Help

- [Help & FAQ](https://xerotunes.com/support): install guides, system
  requirements and fixes for common problems.
- [Guides](https://xerotunes.com/blog) on the website.
- [Discord](https://discord.gg/DaKyJ3q9rF) for questions and chat.
- [Report a bug or ask for a feature](https://github.com/ITESaurabh/XeroTunes/issues).
  Mention your operating system and XeroTunes version. Both are in
  **Settings → About**.

## Support the project

XeroTunes is free and made by one developer. If it's useful to you, you can
[sponsor it on GitHub](https://github.com/sponsors/ITESaurabh) or
[donate through the website](https://xerotunes.com/#support).

## License

[GPL-3.0](LICENSE)
