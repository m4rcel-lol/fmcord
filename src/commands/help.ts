import { SlashCommandBuilder } from "discord.js";
import { infoEmbed } from "../utils/embeds";
import { Command } from "./Command";

const commandList = [
  "`/join` Join your voice channel and lock FMCord there.",
  "`/play query:` Play a URL, playlist, direct audio file, or search query.",
  "`/pause` Pause playback.",
  "`/resume` Resume playback.",
  "`/skip` Skip the current track.",
  "`/stop` Stop playback and clear the queue.",
  "`/disconnect` Leave voice and clear the queue.",
  "`/leave` Alias-style voice leave command.",
  "`/queue page:` Show upcoming tracks.",
  "`/nowplaying` Refresh the live now-playing panel in the voice chat.",
  "`/volume value:` Set volume from 1 to 150.",
  "`/loop mode:` Set loop mode: off, track, or queue.",
  "`/shuffle` Shuffle upcoming tracks.",
  "`/remove position:` Remove a queued track.",
  "`/clear` Clear queued tracks only.",
  "`/ping` Show latency and uptime.",
  "`/about` Show FMCord information."
];

export const helpCommand: Command = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show FMCord commands."),
  async execute(interaction) {
    await interaction.reply({
      embeds: [
        infoEmbed("FMCord help", commandList.join("\n")).setFooter({
          text: "Tip: use /play never gonna give you up to test playback."
        })
      ],
      ephemeral: true
    });
  }
};
