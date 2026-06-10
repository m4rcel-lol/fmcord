import { Client } from "discord.js";

export type FMCordEmojiName =
  | "music"
  | "note_information"
  | "notes_song_title"
  | "error"
  | "nowplaying"
  | "nodejs"
  | "typescript"
  | "ytdlp"
  | "discord";

type UsableEmoji = {
  name: string | null;
  toString(): string;
};

const fallbackEmoji: Record<FMCordEmojiName, string> = {
  music: "🎵",
  note_information: "ℹ️",
  notes_song_title: "🎶",
  error: "❌",
  nowplaying: "▶️",
  nodejs: "🟢",
  typescript: "🔷",
  ytdlp: "📥",
  discord: "💬"
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
  return findCustomEmoji(name, guildId)?.toString() ?? fallbackEmoji[name];
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
