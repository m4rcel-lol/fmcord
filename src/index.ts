import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config";
import { deployCommands } from "./deploy-commands";
import { registerErrorHandlers } from "./events/error";
import { registerInteractionCreateEvent } from "./events/interactionCreate";
import { registerReadyEvent } from "./events/ready";
import { registerVoiceStateUpdateEvent } from "./events/voiceStateUpdate";
import { logger } from "./logger";
import { musicService } from "./music/MusicService";

async function main(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });

  musicService.init(client);
  registerErrorHandlers(client);
  registerReadyEvent(client);
  registerInteractionCreateEvent(client);
  registerVoiceStateUpdateEvent(client);

  await deployCommands();
  await client.login(config.discordToken);
}

main().catch((error) => {
  logger.error("FMCord failed to start", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
