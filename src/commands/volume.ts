import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const volumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume for this server.")
    .addIntegerOption((option) =>
      option.setName("value").setDescription("Volume from 1 to 150.").setMinValue(1).setMaxValue(150).setRequired(true)
    ),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const volume = interaction.options.getInteger("value", true);
      musicService.setVolume(interaction.guildId!, volume);
      await interaction.reply({ embeds: [successEmbed("Volume updated", `Volume is now **${volume}%**.`)], ephemeral: true });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Volume failed", error instanceof Error ? error.message : "Could not set volume.")], ephemeral: true });
    }
  }
};
