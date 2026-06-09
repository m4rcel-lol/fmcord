import { SlashCommandBuilder } from "discord.js";
import { musicService } from "../music/MusicService";
import { infoEmbed, safeText } from "../utils/embeds";
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

    const embed = infoEmbed("Music queue");

    if (current) {
      embed.addFields({
        name: "Now playing",
        value: `[${safeText(current.title, 180)}](${current.url}) • ${current.duration} • <@${current.requestedBy}>`
      });
    } else {
      embed.addFields({ name: "Now playing", value: "Nothing is playing right now." });
    }

    if (queue.length === 0) {
      embed.addFields({ name: "Upcoming", value: "The queue is empty." });
    } else {
      const lines = page.items.map((track, index) => {
        const position = page.offset + index + 1;
        return `**${position}.** [${safeText(track.title, 90)}](${track.url}) • ${track.duration} • <@${track.requestedBy}>`;
      });
      embed.addFields({ name: `Upcoming — Page ${page.page}/${page.totalPages}`, value: lines.join("\n") });
      embed.setFooter({ text: `${queue.length} queued track${queue.length === 1 ? "" : "s"}` });
    }

    await interaction.reply({ embeds: [embed] });
  }
};
