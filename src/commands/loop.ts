import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { LoopMode } from "../music/Track";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { Command } from "./Command";

export const loopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Loop mode.")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "track", value: "track" },
          { name: "queue", value: "queue" }
        )
    ),
  async execute(interaction) {
    try {
      musicService.ensureUserInSameVoice(interaction);
      const mode = interaction.options.getString("mode", true) as LoopMode;
      musicService.setLoopMode(interaction.guildId!, mode);
      await interaction.reply({ embeds: [successEmbed("Loop mode updated", `Loop mode is now **${mode}**.`)], ephemeral: true });
    } catch (error) {
      await interaction.reply({ embeds: [errorEmbed("Loop failed", error instanceof Error ? error.message : "Could not set loop mode.")], ephemeral: true });
    }
  }
};
