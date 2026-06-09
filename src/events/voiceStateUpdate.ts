import { Client } from "discord.js";
import { musicService } from "../music/MusicService";

export function registerVoiceStateUpdateEvent(client: Client): void {
  client.on("voiceStateUpdate", (oldState, newState) => {
    const guildId = newState.guild.id || oldState.guild.id;
    musicService.handleVoiceStateUpdate(guildId);
  });
}
