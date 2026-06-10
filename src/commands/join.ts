import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { baseEmbed, errorEmbed } from "../utils/embeds";
import { fmEmoji } from "../utils/emojis";
import { Command } from "./Command";

export const joinCommand: Command = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel without starting playback."),
  async execute(interaction) {
    try {
      const result = await musicService.join(interaction);
      await interaction.reply({
        embeds: [baseEmbed(`${fmEmoji("voice", interaction.guildId)} Joined voice`).setDescription(`Connected to <#${result.channelId}>. FMCord is now locked to that voice channel until you use \`/leave\`.`)]
      });
    } catch (error) {
      await interaction.reply({
        embeds: [errorEmbed("Join failed", error instanceof Error ? error.message : "Could not join your voice channel.")]
      });
    }
  }
};
