import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { UserFacingError } from "../utils/permissions";
import { Command } from "./Command";

export const resumeCommand: Command = {
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume paused playback."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const resumed = musicService.resume(interaction.guildId!);
      if (!resumed) throw new UserFacingError("Playback is not paused.");
      await interaction.reply({ embeds: [successEmbed("Resumed", "Playback has resumed.")], ephemeral: true });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Resume failed", error instanceof Error ? error.message : "Could not resume.")], ephemeral: true });
    }
  }
};
