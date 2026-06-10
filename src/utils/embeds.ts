import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { fmEmoji, FMCordEmojiName } from "./emojis";

export const colors = {
  primary: 0x8b5cf6,
  accent: 0x22d3ee,
  success: 0x22c55e,
  warning: 0xf59e0b,
  error: 0xef4444,
  neutral: 0x111827
} as const;

const FOOTER = "FMCord • lightweight slash music";

function titleWithEmoji(emojiName: FMCordEmojiName, title: string): string {
  return `${fmEmoji(emojiName)} ${stripLeadingEmoji(title)}`;
}

function stripLeadingEmoji(title: string): string {
  return title
    .replace(/^(?:✅|❌|⚠️|🎵|🎶|🎧|▶️|🔎|➕|ℹ️)\s*/u, "")
    .trim();
}

export function baseEmbed(title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(colors.primary)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(titleWithEmoji("note_information", title)).setColor(colors.success);
  if (description) embed.setDescription(description);
  return embed;
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(titleWithEmoji("error", title)).setColor(colors.error);
  if (description) embed.setDescription(description);
  return embed;
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(titleWithEmoji("note_information", title)).setColor(colors.primary);
  if (description) embed.setDescription(description);
  return embed;
}

export function musicEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(titleWithEmoji("music", title)).setColor(colors.accent);
  if (description) embed.setDescription(description);
  return embed;
}

export function nowPlayingTitle(guildId?: string | null): string {
  return `${fmEmoji("nowplaying", guildId)} Now playing`;
}

export function nowPlayingEmbed(description?: string, guildId?: string | null): EmbedBuilder {
  const embed = baseEmbed(nowPlayingTitle(guildId)).setColor(colors.accent);
  if (description) embed.setDescription(description);
  return embed;
}

export function songTitlePrefix(guildId?: string | null): string {
  return fmEmoji("notes_song_title", guildId);
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(titleWithEmoji("error", title)).setColor(colors.warning);
  if (description) embed.setDescription(description);
  return embed;
}

export function safeText(value: string, maxLength = 256): string {
  const escaped = escapeMarkdown(value.replace(/\s+/g, " ").trim());
  if (escaped.length <= maxLength) return escaped;
  return `${escaped.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function compactTrackLink(title: string, url: string, maxLength = 180): string {
  return `[${safeText(title, maxLength)}](${url})`;
}

export function statusPill(value: string): string {
  return `\`${value}\``;
}
