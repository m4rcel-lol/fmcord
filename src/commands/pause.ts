import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { UserFacingError } from "../utils/permissions";
import { Command } from "./Command";

export const pauseCommand: Command = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause the current track."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const paused = musicService.pause(interaction.guildId!);
      if (!paused) throw new UserFacingError("Playback is not currently running.");
      await interaction.reply({ embeds: [successEmbed("Paused", "Playback has been paused.")] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Pause failed", error instanceof Error ? error.message : "Could not pause.")], ephemeral: true });
    }
  }
};
