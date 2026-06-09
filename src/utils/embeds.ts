import { EmbedBuilder, escapeMarkdown } from "discord.js";

export const colors = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
  neutral: 0x2b2d31
} as const;

export function baseEmbed(title: string): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setColor(colors.primary).setTimestamp();
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(title).setColor(colors.success);
  if (description) embed.setDescription(description);
  return embed;
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(title).setColor(colors.error);
  if (description) embed.setDescription(description);
  return embed;
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(title).setColor(colors.primary);
  if (description) embed.setDescription(description);
  return embed;
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(title).setColor(colors.warning);
  if (description) embed.setDescription(description);
  return embed;
}

export function safeText(value: string, maxLength = 256): string {
  const escaped = escapeMarkdown(value.replace(/\s+/g, " ").trim());
  if (escaped.length <= maxLength) return escaped;
  return `${escaped.slice(0, Math.max(0, maxLength - 1))}…`;
}
