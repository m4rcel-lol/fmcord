import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { UserFacingError } from "../utils/permissions";
import { Command } from "./Command";

export const shuffleCommand: Command = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the upcoming queue."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const count = musicService.shuffle(interaction.guildId!);
      if (count < 2) throw new UserFacingError("There are not enough queued tracks to shuffle.");
      await interaction.reply({ embeds: [successEmbed("Queue shuffled", `Shuffled **${count}** upcoming tracks.`)], ephemeral: true });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Shuffle failed", error instanceof Error ? error.message : "Could not shuffle.")], ephemeral: true });
    }
  }
};
