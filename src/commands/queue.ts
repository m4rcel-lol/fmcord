import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { compactTrackLink, musicEmbed, safeText, statusPill } from "../utils/embeds";
import { paginate } from "../utils/pagination";
import { Command } from "./Command";

export const queueCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current queue.")
    .addIntegerOption((option) => option.setName("page").setDescription("Queue page number.").setMinValue(1).setRequired(false)),
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const current = musicService.getCurrent(guildId);
    const queue = musicService.getQueue(guildId);
    const requestedPage = interaction.options.getInteger("page") ?? 1;
    const page = paginate([...queue], requestedPage, 10);

    const embed = musicEmbed("📜 Music queue")
      .addFields({
        name: "▶️ Now playing",
        value: current
          ? `${compactTrackLink(current.title, current.url, 170)}\n${statusPill(current.duration)} • <@${current.requestedBy}>`
          : "Nothing is playing right now."
      });

    if (queue.length === 0) {
      embed.addFields({ name: "Upcoming", value: "The queue is empty. Add something with `/play`." });
    } else {
      const lines = page.items.map((track, index) => {
        const position = page.offset + index + 1;
        return `**${position}.** ${compactTrackLink(track.title, track.url, 85)}\n└ ${statusPill(track.duration)} • <@${track.requestedBy}> • ${safeText(track.source, 40)}`;
      });
      embed.addFields({ name: `Upcoming — Page ${page.page}/${page.totalPages}`, value: lines.join("\n") });
      embed.setFooter({ text: `FMCord • ${queue.length} queued track${queue.length === 1 ? "" : "s"}` });
    }

    await interaction.reply({ embeds: [embed] });
  }
};
