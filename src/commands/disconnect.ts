import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const disconnectCommand: Command = {
  data: new SlashCommandBuilder().setName("disconnect").setDescription("Disconnect the bot and clear the queue."),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      musicService.disconnect(interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Disconnected", "I left the voice channel and cleared the queue.")] });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Disconnect failed", error instanceof Error ? error.message : "Could not disconnect.")], ephemeral: true });
    }
  }
};
