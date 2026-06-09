import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, infoEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const nowPlayingCommand: Command = {
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Refresh and show the current now-playing panel."),
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    try {
      const embed = musicService.createNowPlayingEmbed(guildId);
      if (!embed) {
        await interaction.reply({ embeds: [errorEmbed("Nothing playing", "There is no active track right now.")], flags: MessageFlags.Ephemeral });
        return;
      }

      await musicService.refreshNowPlayingPanel(guildId);
      await interaction.reply({
        embeds: [infoEmbed("Now-playing panel refreshed", "I updated the existing now-playing embed in the voice channel chat instead of sending another public embed.")],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.reply({
        embeds: [errorEmbed("Now playing failed", error instanceof Error ? error.message : "Could not refresh the now-playing panel.")],
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
