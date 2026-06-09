import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { errorEmbed, infoEmbed, safeText } from "../utils/embeds";
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

    const embed = infoEmbed("Now playing", `[${safeText(now.track.title, 180)}](${now.track.url})`)
      .addFields(
        { name: "Duration", value: now.track.duration, inline: true },
        { name: "Elapsed", value: now.progress, inline: false },
        { name: "Requested by", value: `<@${now.track.requestedBy}>`, inline: true },
        { name: "Loop", value: now.loopMode, inline: true },
        { name: "Volume", value: `${now.volume}%`, inline: true },
        { name: "Source", value: safeText(now.track.source, 64), inline: true }
      );

    if (now.track.thumbnail) embed.setThumbnail(now.track.thumbnail);
    await interaction.reply({ embeds: [embed] });
  }
};
