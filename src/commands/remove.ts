import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, safeText, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const removeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue by position.")
    .addIntegerOption((option) =>
      option.setName("position").setDescription("Visible queue position to remove.").setMinValue(1).setRequired(true)
    ),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const position = interaction.options.getInteger("position", true);
      const removed = musicService.remove(interaction.guildId!, position);
      await interaction.reply({ embeds: [successEmbed("Removed from queue", `Removed **${safeText(removed.title, 160)}**.`)] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Remove failed", error instanceof Error ? error.message : "Could not remove that track.")], ephemeral: true });
    }
  }
};
