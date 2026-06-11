# FMCord

FMCord is a lightweight self-hosted Discord music bot built with TypeScript, discord.js v14, @discordjs/voice, yt-dlp, and FFmpeg.

It uses slash commands only. The only required secret is your Discord bot token. Spotify metadata support is optional. SoundCloud public URLs and `sc:` searches are played natively through yt-dlp/FFmpeg without a SoundCloud API key. Spotify URLs are metadata-only and are converted into public-source searches for playback.

## Features

- Slash commands only; no prefix commands
- YouTube URL playback
- YouTube search query playback
- YouTube playlist support with a configurable max playlist size
- Direct audio URL support for common audio formats
- Optional Spotify track, album, and playlist metadata input
- Native public SoundCloud track, set/playlist, and `sc:` search playback through yt-dlp
- Per-server music sessions
- Queue system
- Join, leave, pause, resume, skip, stop, disconnect
- Queue pages
- Live now-playing panel that edits the same message instead of spamming duplicates
- Volume control from 1 to 150
- Loop off / track / queue
- Shuffle, remove, clear
- Idle disconnect
- Empty voice channel disconnect
- Docker Compose deployment
- Alpine Linux container
- FFmpeg included
- yt-dlp included
- No Message Content Intent required

## Requirements

For Docker deployment:

- Docker
- Docker Compose plugin
- A Discord bot token
- The Discord application client ID

For local development:

- Node.js 20.11 or newer
- FFmpeg installed and available as `ffmpeg`
- yt-dlp installed and available as `yt-dlp`

## Creating the Discord bot

1. Open the Discord Developer Portal.
2. Create a new application.
3. Go to **Bot**.
4. Create a bot user.
5. Copy the bot token and put it in `.env` as `DISCORD_TOKEN`.
6. Go to **General Information**.
7. Copy the Application ID and put it in `.env` as `CLIENT_ID`.
8. Go to **OAuth2 → URL Generator**.
9. Select these scopes:
   - `bot`
   - `applications.commands`
10. Select these bot permissions:
   - View Channels
   - Send Messages
   - Embed Links
   - Use Slash Commands
   - Connect
   - Speak
   - Use Voice Activity
   - Set Voice Channel Status *(optional, for the 🎵 song title voice status)*
11. Open the generated invite URL and add the bot to your server.

FMCord does not need Administrator permission.

## Required intents

FMCord uses only:

- Guilds
- Guild Voice States

You do not need Message Content Intent because FMCord only uses slash commands.

## Environment setup

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_test_server_id_optional
NODE_ENV=production
LOG_LEVEL=info
DEFAULT_VOLUME=80
MAX_QUEUE_SIZE=100
MAX_PLAYLIST_SIZE=100
IDLE_TIMEOUT_SECONDS=300
LEAVE_EMPTY_CHANNEL_SECONDS=60
ENABLE_GLOBAL_COMMANDS=false
YTDLP_BINARY=yt-dlp
FFMPEG_BINARY=ffmpeg
ENABLE_VOICE_STATUS=true
VOICE_STATUS_MAX_LENGTH=80

# Optional Spotify metadata/input support
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_MARKET=PL
```

### Slash command registration behavior

- If `GUILD_ID` is set and `ENABLE_GLOBAL_COMMANDS=false`, commands are registered to that guild. This is best for development because updates appear almost instantly.
- If `ENABLE_GLOBAL_COMMANDS=true`, commands are registered globally.
- If `GUILD_ID` is empty, FMCord falls back to global command registration.

Global command updates can take a while to appear in Discord.

## Docker Compose deployment

Build and start:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f fmcord
```

Stop:

```bash
docker compose down
```

Update after editing code:

```bash
docker compose up -d --build
```

## Local development

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Build TypeScript:

```bash
npm run build
```

Run compiled build:

```bash
npm start
```

Make sure `yt-dlp` and `ffmpeg` are installed locally if you run without Docker.

## Slash commands

| Command | Description |
| --- | --- |
| `/join` | Join your current voice channel without starting music. |
| `/play query:<string>` | Play YouTube URLs/searches, public SoundCloud URLs/searches, Spotify metadata links, or direct audio URLs. |
| `/pause` | Pause playback. |
| `/resume` | Resume playback. |
| `/skip` | Skip the current track. |
| `/stop` | Stop playback and clear the queue. |
| `/disconnect` | Leave the voice channel and clear the queue. |
| `/leave` | Leave the voice channel and clear the queue. |
| `/queue page:<integer>` | Show the queue with pagination. |
| `/nowplaying` | Refresh the existing live now-playing panel; shows current track, upcoming count, loop mode, volume, state, source, and voice channel. |
| `/volume value:<1-150>` | Set playback volume for the current server session. |
| `/loop mode:<off\|track\|queue>` | Set loop mode. |
| `/shuffle` | Shuffle upcoming tracks. |
| `/remove position:<integer>` | Remove a queued track by position. |
| `/clear` | Clear upcoming tracks without stopping the current track. |
| `/help` | Show command help. |
| `/ping` | Show latency and uptime. |
| `/about` | Show FMCord info. |

## How music extraction works without API keys

FMCord uses `yt-dlp`, a free open-source extractor, to resolve YouTube URLs and YouTube search queries. No YouTube Data API key is used. Spotify links are resolved with the official Spotify Web API for metadata only, then converted into YouTube/public-source search targets. Public SoundCloud URLs and `sc:` searches are resolved by yt-dlp directly, so they can play from SoundCloud without an official SoundCloud developer app or API key. FMCord does not stream, download, rip, or rebroadcast Spotify audio directly.

Playback is handled by FFmpeg. FMCord resolves a direct media URL with yt-dlp, then FFmpeg reconnects to the stream when possible, fixes timestamps with async resampling, encodes the audio as Opus, and @discordjs/voice sends it to the voice channel. This avoids Node-side PCM encoding work and helps prevent lag, random speed changes, and stutters on weaker VPS machines.

## Notes about YouTube reliability

YouTube changes can sometimes break third-party extractors. If playback suddenly fails for YouTube, update the Docker image or rebuild after Alpine packages have a newer `yt-dlp` version:

```bash
docker compose build --no-cache
docker compose up -d
```

For local installs, update `yt-dlp` using your system package manager.

Cookies are intentionally not required or enabled by default. Do not add private cookies unless you understand the security risk.

## Security notes

- Never commit `.env`.
- Never share your Discord bot token.
- FMCord never prints the Discord token in logs.
- User input is passed to `yt-dlp` and FFmpeg through safe argument arrays, not shell strings.
- Queue and playlist sizes are limited.
- The bot does not request Administrator permission.
- The Docker runtime uses a non-root user.
- Only minimal Discord intents are used.

## Troubleshooting

### Slash commands do not show up

Set `GUILD_ID` to your server ID for instant command registration during testing. Global commands may take time to appear.

### Bot joins but no audio plays

Check logs:

```bash
docker compose logs -f fmcord
```

Make sure the bot has Connect and Speak permissions in the voice channel.

### YouTube playback fails

Rebuild to get the newest Alpine `yt-dlp` package:

```bash
docker compose build --no-cache
docker compose up -d
```

### `yt-dlp` not found in local development

Install yt-dlp locally or set `YTDLP_BINARY` in `.env` to its full path.

### `ffmpeg` not found in local development

Install FFmpeg locally or set `FFMPEG_BINARY` in `.env` to its full path.

### Bot says it is already in another voice channel

FMCord is intentionally limited to one voice channel per server. Use `/leave` or `/disconnect` from the same channel, or restart the bot if Discord left a stale connection.

### Permission errors

Invite the bot with these permissions: View Channels, Send Messages, Embed Links, Use Slash Commands, Connect, Speak, and Use Voice Activity. Add **Set Voice Channel Status** if you want the voice channel to show `🎵 Song Title`.

## FAQ

### Does FMCord need a YouTube API key?

No.

### Does FMCord need Message Content Intent?

No. It only uses slash commands.

### Does FMCord support Spotify or SoundCloud links?

Yes. Spotify track, album, and playlist links are metadata/input only and use the official Spotify Web API when `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set. SoundCloud public track URLs, sets/playlists, and `sc:` searches are resolved directly with yt-dlp, so no SoundCloud API key is required.

### Does FMCord download songs to disk?

No. The normal playback path streams through yt-dlp and FFmpeg pipes.

### Can I raise playlist size?

Yes. Change `MAX_PLAYLIST_SIZE`, but large playlists can be slower and must still fit under `MAX_QUEUE_SIZE`.

## License

MIT — Copyright (c) 2026 Marcel R.


## Docker build note

This project intentionally lets Docker generate dependencies from `package.json` during the image build. If you copied an older ZIP that included a `package-lock.json` generated on another registry, remove it before building:

```bash
rm -f package-lock.json
docker compose build --no-cache
```

If you see `npm error Exit handler never called!` during Docker build, rebuild with the included Dockerfile, which uses `npm install --registry=https://registry.npmjs.org/` inside the build stage.

## v1.1.0 Performance Notes

This build improves `/play` startup speed in two ways:

1. **Parallel resolving + voice connect** — FMCord connects to voice while yt-dlp resolves the requested track.
2. **Direct stream URL playback** — when yt-dlp returns a fresh direct media URL, FMCord sends that URL straight into FFmpeg.
3. **FFmpeg Opus output** — FFmpeg now produces Discord-ready Opus audio with reconnect and timestamp correction options, reducing stutter and weird speed changes on low-resource servers.

If a direct stream URL is missing or expired, FMCord safely resolves a fresh stream URL with yt-dlp before playback. This fallback keeps the bot reliable when YouTube changes stream URLs.

The embeds were also redesigned with clearer status fields, better queue formatting, source/volume/loop info, and a visible playback mode indicator.

## v1.4.0 Live Panel Notes

This build keeps one live now-playing panel per server and edits it instead of sending duplicate public now-playing embeds. If FMCord restarts or loses the saved message ID, it scans recent bot messages, adopts the latest existing now-playing panel, edits it, and removes older duplicate FMCord panels when possible. The panel updates when:

- a new song starts
- `/volume` changes volume
- `/loop` changes loop mode
- the queue changes through `/play`, `/clear`, `/remove`, or `/shuffle`
- playback is paused or resumed
- the periodic timer refreshes the panel without showing buggy progress/time-left fields

The panel shows the current track, total duration, upcoming song count, loop mode, volume, playback state, requester, source, and voice channel. `/join` and `/leave` are available, and FMCord stays locked to one voice channel per server until it leaves. The Now Playing panel is event-based: it edits only when the track changes, the queue changes, loop/volume changes, or the playback state changes.


## v1.7 patch notes

- Removed progress and time-left fields from the public Now Playing panel because they were unreliable on some streams.
- Kept the single live Now Playing panel system. The bot still edits the existing panel when state, queue, volume, loop mode, or track info changes.
- Music control command replies are now private/ephemeral for the user running the command. `/join` and `/leave` remain visible.


## v1.8 patch notes

- Added custom tech emojis to `/about` when available: `:nodejs:`, `:typescript:`, `:ytdlp:`, and `:discord:`.
- About command values place tech emojis after the text, for example `Node.js v20.x :nodejs:`.
- Keeps Unicode fallbacks if custom emojis are unavailable.


## v2.3 playback cleanup

- Re-added Spotify metadata/input support with cleaner API handling and cached Client Credentials tokens.
- Re-added SoundCloud support and later upgraded it to native public SoundCloud yt-dlp playback.
- `/play` supports YouTube URLs/search terms, Spotify metadata links, public SoundCloud URLs/searches, and direct audio URLs.
- FFmpeg now outputs Discord-ready Opus instead of raw PCM to reduce Node-side encoding load.
- Added FFmpeg reconnect, timestamp generation, corrupt packet discard, and async resampling flags for smoother playback.
- Now Playing panel updates are event-based instead of timer-based, reducing Discord API edits and preventing constant embed refreshes.


## v2.13 SoundCloud native playback notes

- Spotify playlist and album links collect readable track metadata up to `MAX_PLAYLIST_SIZE` and queue each item. The default is now 100.
- SoundCloud set/playlist URLs now expand into individual queued SoundCloud tracks when yt-dlp can read the public set.

- Spotify support is metadata-only: track, album, and playlist links are read with the Spotify Web API, then converted into public-source search targets for yt-dlp.
- SoundCloud support is native public-source playback: public SoundCloud track URLs, sets/playlists, and `sc:` searches are resolved through yt-dlp and streamed through FFmpeg. If native extraction fails, FMCord can fall back to metadata-to-YouTube matching when URL metadata is available.
- FMCord does not stream Spotify audio directly and does not store downloaded audio files. SoundCloud playback is for public tracks that yt-dlp can resolve.
- If Spotify playlist access fails because of Spotify account/app restrictions, the bot returns a clean error instead of crashing.


## v2.13 no-key SoundCloud playback

SoundCloud no longer requires a SoundCloud developer app in FMCord. Public SoundCloud track URLs and set/playlist URLs are resolved with yt-dlp and streamed through FFmpeg. You can also search SoundCloud directly with `sc: query` or `soundcloud: query`. Spotify remains metadata-only and still needs optional Spotify credentials for Spotify URLs.
