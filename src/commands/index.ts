import { aboutCommand } from "./about";
import { clearCommand } from "./clear";
import { Command } from "./Command";
import { disconnectCommand } from "./disconnect";
import { helpCommand } from "./help";
import { loopCommand } from "./loop";
import { nowPlayingCommand } from "./nowplaying";
import { pauseCommand } from "./pause";
import { pingCommand } from "./ping";
import { playCommand } from "./play";
import { queueCommand } from "./queue";
import { removeCommand } from "./remove";
import { resumeCommand } from "./resume";
import { shuffleCommand } from "./shuffle";
import { skipCommand } from "./skip";
import { stopCommand } from "./stop";
import { volumeCommand } from "./volume";

export const commands: Command[] = [
  playCommand,
  pauseCommand,
  resumeCommand,
  skipCommand,
  stopCommand,
  disconnectCommand,
  queueCommand,
  nowPlayingCommand,
  volumeCommand,
  loopCommand,
  shuffleCommand,
  removeCommand,
  clearCommand,
  helpCommand,
  pingCommand,
  aboutCommand
];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));
