import "dotenv/config";

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config = {
  discordToken: readRequired("DISCORD_TOKEN"),
  clientId: readRequired("CLIENT_ID"),
  guildId: process.env.GUILD_ID?.trim() || undefined,
  nodeEnv: process.env.NODE_ENV ?? "production",
  defaultVolume: readNumber("DEFAULT_VOLUME", 80, 1, 150),
  maxQueueSize: readNumber("MAX_QUEUE_SIZE", 100, 1, 1000),
  maxPlaylistSize: readNumber("MAX_PLAYLIST_SIZE", 25, 1, 100),
  idleTimeoutSeconds: readNumber("IDLE_TIMEOUT_SECONDS", 300, 30, 3600),
  leaveEmptyChannelSeconds: readNumber("LEAVE_EMPTY_CHANNEL_SECONDS", 60, 10, 900),
  enableGlobalCommands: readBoolean("ENABLE_GLOBAL_COMMANDS", false),
  enableVoiceStatus: readBoolean("ENABLE_VOICE_STATUS", true),
  voiceStatusMaxLength: readNumber("VOICE_STATUS_MAX_LENGTH", 80, 20, 500),
  ytdlpBinary: process.env.YTDLP_BINARY?.trim() || "yt-dlp",
  ffmpegBinary: process.env.FFMPEG_BINARY?.trim() || "ffmpeg"
} as const;
