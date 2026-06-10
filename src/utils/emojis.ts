import { Client } from "discord.js";

export type FMCordEmojiName =
  | "music"
  | "note_information"
  | "songtitle"
  | "error"
  | "warning"
  | "warn"
  | "nowplaying"
  | "vinyl"
  | "song"
  | "loading"
  | "nodejs"
  | "typescript"
  | "ytdlp"
  | "discord"
  | "ffmpeg"
  | "duration"
  | "upcoming"
  | "loop"
  | "volume"
  | "requested"
  | "source"
  | "voice";

type UsableEmoji = {
  name: string | null;
  toString(): string;
};

const fallbackEmoji: Record<FMCordEmojiName, string> = {
  music: "🎵",
  note_information: "ℹ️",
  songtitle: "🎶",
  error: "⚠️",
  warning: "⚠️",
  warn: "⚠️",
  nowplaying: "🎵",
  vinyl: "🎵",
  song: "🎵",
  loading: "⏳",
  nodejs: "🟢",
  typescript: "🔷",
  ytdlp: "📥",
  discord: "💬",
  ffmpeg: "🎞️",
  duration: "⏱️",
  upcoming: "📜",
  loop: "🔁",
  volume: "🔊",
  requested: "👤",
  source: "🌐",
  voice: "🔈"
};

let clientRef: Client | null = null;

export function initEmojiResolver(client: Client): void {
  clientRef = client;
}

export async function warmEmojiCache(): Promise<void> {
  const applicationEmojis = (clientRef?.application as unknown as { emojis?: { fetch?: () => Promise<unknown> } } | null)?.emojis;
  try {
    await applicationEmojis?.fetch?.();
  } catch {
    // Application emoji fetching is optional. Guild emoji cache is enough for normal server emojis.
  }
}

export function fmEmoji(name: FMCordEmojiName, guildId?: string | null): string {
  const emojiName = resolveEmojiName(name);
  return findCustomEmoji(emojiName, guildId)?.toString() ?? fallbackEmoji[emojiName];
}

function resolveEmojiName(name: FMCordEmojiName): FMCordEmojiName {
  // The old internal names stay supported so older code paths do not break,
  // but the visible custom emojis now resolve to :song: and :warn:.
  if (name === "nowplaying" || name === "vinyl") return "song";
  if (name === "error" || name === "warning") return "warn";
  return name;
}

function findCustomEmoji(name: FMCordEmojiName, guildId?: string | null): UsableEmoji | null {
  if (!clientRef) return null;

  const guildEmoji = guildId
    ? clientRef.guilds.cache.get(guildId)?.emojis.cache.find((emoji) => emoji.name === name) ?? null
    : null;
  if (guildEmoji) return guildEmoji;

  const applicationEmoji = findApplicationEmoji(name);
  if (applicationEmoji) return applicationEmoji;

  for (const guild of clientRef.guilds.cache.values()) {
    const emoji = guild.emojis.cache.find((item) => item.name === name);
    if (emoji) return emoji;
  }

  return null;
}

function findApplicationEmoji(name: FMCordEmojiName): UsableEmoji | null {
  const application = clientRef?.application as unknown as {
    emojis?: { cache?: { find?: (predicate: (emoji: UsableEmoji) => boolean) => UsableEmoji | undefined } };
  } | null;

  return application?.emojis?.cache?.find?.((emoji) => emoji.name === name) ?? null;
}
