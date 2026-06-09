import { REST, Routes } from "discord.js";
import { commands } from "./commands";
import { config } from "./config";
import { logger } from "./logger";

export async function deployCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const body = commands.map((command) => command.data.toJSON());

  if (config.enableGlobalCommands || !config.guildId) {
    if (!config.guildId && !config.enableGlobalCommands) {
      logger.warn("GUILD_ID is not set, so FMCord will register global commands. Global commands may take up to an hour to appear.");
    }
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    logger.info(`Registered ${body.length} global slash commands.`);
    return;
  }

  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  logger.info(`Registered ${body.length} guild slash commands for guild ${config.guildId}.`);
}
