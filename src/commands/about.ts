import { version as discordJsVersion } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { musicEmbed } from "../utils/embeds";
import { fmEmoji } from "../utils/emojis";
import { Command } from "./Command";

export const aboutCommand: Command = {
  data: new SlashCommandBuilder().setName("about").setDescription("Show information about FMCord."),
  async execute(interaction) {
    const guildId = interaction.guildId;

    await interaction.reply({
      embeds: [
        musicEmbed(
          "About FMCord",
          "A lightweight, self-hosted Discord music bot using slash commands only."
        ).addFields(
          { name: "Version", value: "2.15.0", inline: true },
          { name: "Author", value: "Marcel R.", inline: true },
          { name: "Runtime", value: `Node.js ${process.version} ${fmEmoji("nodejs", guildId)}`, inline: true },
          { name: "Language", value: `TypeScript ${fmEmoji("typescript", guildId)}`, inline: true },
          { name: "Discord library", value: `discord.js ${discordJsVersion} ${fmEmoji("discord", guildId)}`, inline: true },
          { name: "Extractor", value: `yt-dlp ${fmEmoji("ytdlp", guildId)}`, inline: true },
          { name: "Metadata", value: "Spotify Web API + native SoundCloud URLs", inline: true },
          { name: "Audio", value: `FFmpeg ${fmEmoji("ffmpeg", guildId)}`, inline: true },
          { name: "API keys", value: "Discord + optional Spotify; no SoundCloud key", inline: true }
        )
      ]
    });
  }
};
