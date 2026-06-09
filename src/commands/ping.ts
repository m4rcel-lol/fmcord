import { SlashCommandBuilder } from "discord.js";
import { infoEmbed } from "../utils/embeds";
import { formatUptime } from "../utils/formatTime";
import { Command } from "./Command";

export const pingCommand: Command = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Show bot latency and uptime."),
  async execute(interaction) {
    const sent = Date.now();
    await interaction.reply({ embeds: [infoEmbed("Pinging…", "Checking latency...")], ephemeral: true });
    const roundTrip = Date.now() - sent;
    const websocket = Math.round(interaction.client.ws.ping);
    await interaction.editReply({
      embeds: [
        infoEmbed("Pong", `Round trip: **${roundTrip}ms**\nWebSocket: **${websocket}ms**\nUptime: **${formatUptime(process.uptime() * 1000)}**`)
      ]
    });
  }
};
