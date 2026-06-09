import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const clearCommand: Command = {
  data: new SlashCommandBuilder().setName("clear").setDescription("Clear queued tracks without stopping the current track."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const count = musicService.clearQueue(interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Queue cleared", `Removed **${count}** queued track${count === 1 ? "" : "s"}.`)] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Clear failed", error instanceof Error ? error.message : "Could not clear the queue.")], ephemeral: true });
    }
  }
};
