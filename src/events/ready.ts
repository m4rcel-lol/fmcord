import { ActivityType, Client } from "discord.js";
import { logger } from "../logger";

export function registerReadyEvent(client: Client): void {
  client.once("ready", (readyClient) => {
    readyClient.user.setPresence({
      activities: [{ name: "/play", type: ActivityType.Listening }],
      status: "online"
    });
    logger.info(`FMCord is online as ${readyClient.user.tag}.`);
  });
}
