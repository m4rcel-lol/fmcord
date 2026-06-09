import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  VoiceBasedChannel
} from "discord.js";

export class UserFacingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function getMemberVoiceChannel(interaction: ChatInputCommandInteraction): VoiceBasedChannel {
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const channel = member?.voice.channel;
  if (!channel) throw new UserFacingError("You must be in a voice channel first.");
  return channel;
}

export function assertVoicePermissions(interaction: ChatInputCommandInteraction, channel: VoiceBasedChannel): void {
  const me = interaction.guild?.members.me;
  if (!me) throw new UserFacingError("I could not check my server permissions yet. Try again in a moment.");

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    throw new UserFacingError("I need permission to view your voice channel.");
  }
  if (!permissions.has(PermissionFlagsBits.Connect)) {
    throw new UserFacingError("I need permission to connect to your voice channel.");
  }
  if (!permissions.has(PermissionFlagsBits.Speak)) {
    throw new UserFacingError("I need permission to speak in your voice channel.");
  }
}
