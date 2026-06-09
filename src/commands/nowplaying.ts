import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { compactTrackLink, errorEmbed, musicEmbed, safeText, statusPill } from "../utils/embeds";
import { Command } from "./Command";

export const nowPlayingCommand: Command = {
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the currently playing track."),
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const now = musicService.getNowPlaying(guildId);
    if (!now) {
      await interaction.reply({ embeds: [errorEmbed("Nothing playing", "There is no active track right now.")], ephemeral: true });
      return;
    }

    const embed = musicEmbed("🎧 Now playing", `### ${compactTrackLink(now.track.title, now.track.url, 190)}`)
      .addFields(
        { name: "Progress", value: now.progress, inline: false },
        { name: "⏱️ Duration", value: now.track.duration, inline: true },
        { name: "👤 Requested by", value: `<@${now.track.requestedBy}>`, inline: true },
        { name: "🌐 Source", value: statusPill(safeText(now.track.source, 64)), inline: true },
        { name: "🔁 Loop", value: statusPill(now.loopMode), inline: true },
        { name: "🔊 Volume", value: statusPill(`${now.volume}%`), inline: true },
        { name: "⚡ Stream", value: statusPill(now.track.streamUrl ? "Direct" : "Extractor fallback"), inline: true }
      );

    if (now.track.thumbnail) embed.setThumbnail(now.track.thumbnail);
    await interaction.reply({ embeds: [embed] });
  }
};
