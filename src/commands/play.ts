import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { compactTrackLink, errorEmbed, musicEmbed, safeText, statusPill } from "../utils/embeds";
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
      await interaction.editReply({
        embeds: [
          musicEmbed("🔎 Finding your track…", `Searching for **${safeText(query, 120)}** and preparing the voice connection.`)
            .addFields({ name: "Status", value: statusPill("Resolving with yt-dlp"), inline: true })
        ]
      });

      const result = await musicService.play(interaction, query);
      const first = result.tracks[0];
      if (!first) throw new UserFacingError("No playable results were found.");

      const title = result.startedImmediately ? "▶️ Now playing" : "➕ Added to queue";
      const description = result.tracks.length === 1
        ? `### ${compactTrackLink(first.title, first.url, 190)}`
        : `### Added **${result.tracks.length}** tracks\nFirst track: ${compactTrackLink(first.title, first.url, 150)}`;

      const embed = musicEmbed(title, description).addFields(
        { name: "⏱️ Duration", value: first.duration, inline: true },
        { name: "👤 Requested by", value: `<@${first.requestedBy}>`, inline: true },
        { name: "📍 Position", value: result.queuePosition === 0 ? statusPill("Now playing") : statusPill(`#${result.queuePosition}`), inline: true },
        { name: "🌐 Source", value: statusPill(safeText(first.source, 64)), inline: true },
        { name: "📜 Queue", value: statusPill(`${result.queueLength} upcoming`), inline: true },
        { name: "⚡ Playback", value: statusPill(first.streamUrl ? "Fast stream URL ready" : "Will resolve on start"), inline: true }
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
