import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { compactTrackLink, errorEmbed, loadingEmbed, musicEmbed, safeText, statusPill } from "../utils/embeds";
import { fmEmoji } from "../utils/emojis";
import { UserFacingError } from "../utils/permissions";
import { Command } from "./Command";

export const playCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from a URL or search query.")
    .addStringOption((option) =>
      option.setName("query").setDescription("YouTube URL/search, public SoundCloud URL/search, Spotify URL metadata, or direct audio URL.").setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query", true);
    const guildId = interaction.guildId;

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({
        embeds: [
          loadingEmbed("Searching song…", `Resolving **${safeText(query, 120)}** and preparing playback.`)
            .addFields({ name: "Status", value: `${fmEmoji("loading", guildId)} ${statusPill("Resolving metadata")}`, inline: true })
        ]
      });

      const result = await musicService.play(interaction, query);
      const first = result.tracks[0];
      if (!first) throw new UserFacingError("No playable results were found.");

      const title = result.startedImmediately ? "Playback starting" : "Added to queue";
      const description = result.tracks.length === 1
        ? `### ${fmEmoji("songtitle", guildId)} ${compactTrackLink(first.title, first.url, 190)}\nThe public **Now playing** embed will be posted in your voice channel chat.`
        : `### Added **${result.tracks.length}** tracks\n${fmEmoji("songtitle", guildId)} First track: ${compactTrackLink(first.title, first.url, 150)}`;

      const embed = musicEmbed(title, description).addFields(
        { name: `${fmEmoji("duration", guildId)} Duration`, value: statusPill(first.duration), inline: true },
        { name: `${fmEmoji("upcoming", guildId)} Upcoming`, value: statusPill(`${result.queueLength} song${result.queueLength === 1 ? "" : "s"}`), inline: true },
        { name: `${fmEmoji("loop", guildId)} Loop`, value: statusPill(result.loopMode), inline: true },
        { name: `${fmEmoji("volume", guildId)} Volume`, value: statusPill(`${result.volume}%`), inline: true },
        { name: `${fmEmoji("nowplaying", guildId)} State`, value: result.queuePosition === 0 ? statusPill("Now playing") : statusPill(`Queued #${result.queuePosition}`), inline: true },
        { name: `${fmEmoji("requested", guildId)} Requested by`, value: `<@${first.requestedBy}>`, inline: true },
        { name: `${fmEmoji("source", guildId)} Source`, value: statusPill(safeText(first.source, 64)), inline: true },
        { name: `${fmEmoji("voice", guildId)} Voice`, value: result.voiceChannelId ? `<#${result.voiceChannelId}>` : "Unknown", inline: true }
      );

      if (first.thumbnail) embed.setThumbnail(first.thumbnail);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const isProviderQuery = /(?:open\.spotify\.com|spotify:|spotify\.link|spoti\.fi|soundcloud\.com)/i.test(query);
      const message = error instanceof UserFacingError
        ? error.message
        : error instanceof Error && (isProviderQuery || error.message.includes("Spotify") || error.message.includes("SoundCloud") || error.message.includes("yt-dlp"))
          ? error.message
          : "I could not play that track. Try a YouTube link/search, public SoundCloud URL/search, Spotify URL, direct audio URL, or different query.";
      const embed = errorEmbed("Play failed", message);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
};
