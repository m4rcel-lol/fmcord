import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const skipCommand: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      musicService.skip(interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Skipped", "Skipping the current track.")] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Skip failed", error instanceof Error ? error.message : "Could not skip.")], ephemeral: true });
    }
  }
};
