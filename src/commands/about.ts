import { version as discordJsVersion } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { infoEmbed } from "../utils/embeds";
import { fmEmoji } from "../utils/emojis";
import { Command } from "./Command";

export const aboutCommand: Command = {
  data: new SlashCommandBuilder().setName("about").setDescription("Show information about FMCord."),
  async execute(interaction) {
    const guildId = interaction.guildId;

    await interaction.reply({
      embeds: [
        infoEmbed(
          `${fmEmoji("music", guildId)} About FMCord`,
          "A lightweight, self-hosted Discord music bot using slash commands only."
        ).addFields(
          { name: `${fmEmoji("note_information", guildId)} Version`, value: "1.8.0", inline: true },
          { name: `${fmEmoji("note_information", guildId)} Author`, value: "Marcel R.", inline: true },
          { name: `${fmEmoji("note_information", guildId)} Runtime`, value: `Node.js ${process.version} ${fmEmoji("nodejs", guildId)}`, inline: true },
          { name: `${fmEmoji("note_information", guildId)} Language`, value: `TypeScript ${fmEmoji("typescript", guildId)}`, inline: true },
          { name: `${fmEmoji("note_information", guildId)} Discord library`, value: `discord.js ${discordJsVersion} ${fmEmoji("discord", guildId)}`, inline: true },
          { name: `${fmEmoji("note_information", guildId)} Extractor`, value: `yt-dlp ${fmEmoji("ytdlp", guildId)}`, inline: true },
          { name: `${fmEmoji("note_information", guildId)} Audio`, value: "FFmpeg", inline: true },
          { name: `${fmEmoji("note_information", guildId)} API keys`, value: "Only Discord bot token required", inline: true }
        )
      ]
    });
  }
};
