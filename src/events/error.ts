import { Client } from "discord.js";
import { logger } from "../logger";

export function registerErrorHandlers(client: Client): void {
  client.on("error", (error) => logger.error("Discord client error", error.stack ?? error.message));
  client.on("warn", (message) => logger.warn(`Discord warning: ${message}`));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", reason instanceof Error ? reason.stack ?? reason.message : String(reason));
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", error.stack ?? error.message);
  });
}
