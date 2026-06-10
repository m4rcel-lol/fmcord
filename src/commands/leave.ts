import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const leaveCommand: Command = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and clear the queue."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      musicService.leave(interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Left voice", "I left the voice channel and cleared the queue.")] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Leave failed", error instanceof Error ? error.message : "Could not leave voice.")] });
    }
  }
};
