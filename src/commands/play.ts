import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, safeText, successEmbed } from "../utils/embeds";
import { UserFacingError } from "../utils/permissions";
import { Command } from "./Command";

export const playCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from a URL or search query.")
    .addStringOption((option) =>
      option.setName("query").setDescription("YouTube URL, playlist URL, direct audio URL, or search terms.").setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query", true);

    try {
      await interaction.deferReply();
      const result = await musicService.play(interaction, query);
      const first = result.tracks[0];
      if (!first) throw new UserFacingError("No playable results were found.");

      const embed = successEmbed(
        result.startedImmediately ? "Starting playback" : "Added to queue",
        result.tracks.length === 1
          ? `[${safeText(first.title, 180)}](${first.url})`
          : `Added **${result.tracks.length}** tracks from a playlist.`
      ).addFields(
        { name: "Duration", value: first.duration, inline: true },
        { name: "Requested by", value: `<@${first.requestedBy}>`, inline: true },
        { name: "Position", value: result.queuePosition === 0 ? "Now playing" : `#${result.queuePosition}`, inline: true },
        { name: "Source", value: safeText(first.source, 64), inline: true }
      );

      if (first.thumbnail) embed.setThumbnail(first.thumbnail);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error instanceof UserFacingError ? error.message : "I could not play that track. Try a different query or URL.";
      const embed = errorEmbed("Play failed", message);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
};
