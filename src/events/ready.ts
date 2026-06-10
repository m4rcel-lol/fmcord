import { ActivityType, Client } from "discord.js";
import { logger } from "../logger";
import { warmEmojiCache } from "../utils/emojis";

export function registerReadyEvent(client: Client): void {
  client.once("ready", async (readyClient) => {
    readyClient.user.setPresence({
      activities: [{ name: "/play", type: ActivityType.Listening }],
      status: "online"
    });
    await warmEmojiCache();
    logger.info(`FMCord is online as ${readyClient.user.tag}.`);
  });
}
