import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const stopCommand: Command = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      musicService.stop(interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Stopped", "Playback stopped and the queue was cleared.")] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Stop failed", error instanceof Error ? error.message : "Could not stop.")], ephemeral: true });
    }
  }
};
