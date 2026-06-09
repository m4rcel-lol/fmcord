import { version as discordJsVersion } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { infoEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const aboutCommand: Command = {
  data: new SlashCommandBuilder().setName("about").setDescription("Show information about FMCord."),
  async execute(interaction) {
    await interaction.reply({
      embeds: [
        infoEmbed("About FMCord", "A lightweight, self-hosted Discord music bot using slash commands only.")
          .addFields(
            { name: "Version", value: "1.3.0", inline: true },
            { name: "Author", value: "m5rcode / FMCord contributors", inline: true },
            { name: "Runtime", value: `Node.js ${process.version}`, inline: true },
            { name: "Discord library", value: `discord.js ${discordJsVersion}`, inline: true },
            { name: "Audio", value: "yt-dlp + FFmpeg", inline: true },
            { name: "API keys", value: "Only Discord bot token required", inline: true }
          )
      ]
    });
  }
};
