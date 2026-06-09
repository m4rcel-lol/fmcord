import { Client } from "discord.js";
import { commandMap } from "../commands";
import { logger } from "../logger";
import { errorEmbed } from "../utils/embeds";

export function registerInteractionCreateEvent(client: Client): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ embeds: [errorEmbed("Unknown command", "This command is not available.")], ephemeral: true });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Unhandled command error for /${interaction.commandName}`, error instanceof Error ? error.stack ?? error.message : String(error));
      const embed = errorEmbed("Command failed", "Something went wrong while running that command.");
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => undefined);
      }
    }
  });
}
