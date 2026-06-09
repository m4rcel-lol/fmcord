# FMCord

FMCord is a lightweight self-hosted Discord music bot built with TypeScript, discord.js v14, @discordjs/voice, yt-dlp, and FFmpeg.

It uses slash commands only and does not require YouTube API keys, Spotify keys, SoundCloud keys, paid APIs, OAuth apps, cookies, or third-party music credentials. The only required secret is your Discord bot token.

## Features

- Slash commands only; no prefix commands
- YouTube URL playback
- YouTube search query playback
- YouTube playlist support with a configurable max playlist size
- Direct audio URL support for common audio formats
- Other public sources when supported by yt-dlp
- Per-server music sessions
- Queue system
- Pause, resume, skip, stop, disconnect
- Queue pages
- Now playing embed with progress bar
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
MAX_PLAYLIST_SIZE=25
IDLE_TIMEOUT_SECONDS=300
LEAVE_EMPTY_CHANNEL_SECONDS=60
ENABLE_GLOBAL_COMMANDS=false
YTDLP_BINARY=yt-dlp
FFMPEG_BINARY=ffmpeg
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
| `/play query:<string>` | Play a song, playlist, direct audio URL, or search query. |
| `/pause` | Pause playback. |
| `/resume` | Resume playback. |
| `/skip` | Skip the current track. |
| `/stop` | Stop playback and clear the queue. |
| `/disconnect` | Leave the voice channel and clear the queue. |
| `/queue page:<integer>` | Show the queue with pagination. |
| `/nowplaying` | Show current track, elapsed time, progress, requester, loop mode, and volume. |
| `/volume value:<1-150>` | Set playback volume for the current server session. |
| `/loop mode:<off\|track\|queue>` | Set loop mode. |
| `/shuffle` | Shuffle upcoming tracks. |
| `/remove position:<integer>` | Remove a queued track by position. |
| `/clear` | Clear upcoming tracks without stopping the current track. |
| `/help` | Show command help. |
| `/ping` | Show latency and uptime. |
| `/about` | Show FMCord info. |

## How music extraction works without API keys

FMCord uses `yt-dlp`, a free open-source extractor, to resolve public URLs and search queries. For playback, FMCord starts `yt-dlp` as a child process and pipes the selected audio stream into FFmpeg. FFmpeg converts the audio into Discord voice-compatible raw PCM, and @discordjs/voice sends it to the voice channel.

No YouTube Data API key is used. No Spotify API key is used. No SoundCloud API key is used. No paid provider is required.

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

Use `/disconnect` from the same channel, or restart the bot if Discord left a stale connection.

### Permission errors

Invite the bot with these permissions: View Channels, Send Messages, Embed Links, Use Slash Commands, Connect, Speak, and Use Voice Activity.

## FAQ

### Does FMCord need a YouTube API key?

No.

### Does FMCord need Message Content Intent?

No. It only uses slash commands.

### Does FMCord support Spotify links?

Not directly by Spotify API. If yt-dlp can resolve a public source, FMCord can try to play it. Spotify playback usually requires separate handling and is intentionally not included to keep the bot no-key and lightweight.

### Does FMCord download songs to disk?

No. The normal playback path streams through yt-dlp and FFmpeg pipes.

### Can I raise playlist size?

Yes. Change `MAX_PLAYLIST_SIZE`, but large playlists can be slower and more likely to hit extractor limits.

## License

MIT
