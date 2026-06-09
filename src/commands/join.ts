import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const joinCommand: Command = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel without starting playback."),
  async execute(interaction) {
    try {
      const result = await musicService.join(interaction);
      await interaction.reply({
        embeds: [successEmbed("Joined voice", `Connected to <#${result.channelId}>. FMCord is now locked to that voice channel until you use \`/leave\`.`)],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.reply({
        embeds: [errorEmbed("Join failed", error instanceof Error ? error.message : "Could not join your voice channel.")],
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
