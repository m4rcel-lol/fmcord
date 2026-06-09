import { formatTime } from "../utils/formatTime";

export function makeProgressBar(elapsedSeconds: number, totalSeconds?: number | null, size = 18): string {
  if (!totalSeconds || totalSeconds <= 0) return "🔴 Live stream";

  const safeElapsed = Math.max(0, Math.min(elapsedSeconds, totalSeconds));
  const ratio = safeElapsed / totalSeconds;
  const cursor = Math.min(size - 1, Math.max(0, Math.round(ratio * (size - 1))));
  const chars = Array.from({ length: size }, (_, index) => (index === cursor ? "🔘" : "▬"));
  return `${chars.join("")} ${formatTime(safeElapsed)} / ${formatTime(totalSeconds)}`;
}


export function makeProgressCodeBlock(elapsedSeconds: number, totalSeconds?: number | null, size = 22): string {
  if (!totalSeconds || totalSeconds <= 0) {
    return "```txt\nLIVE STREAM\n```";
  }

  const safeElapsed = Math.max(0, Math.min(elapsedSeconds, totalSeconds));
  const remainingSeconds = Math.max(0, totalSeconds - safeElapsed);
  const ratio = safeElapsed / totalSeconds;
  const cursor = Math.min(size - 1, Math.max(0, Math.round(ratio * (size - 1))));
  const bar = Array.from({ length: size }, (_, index) => {
    if (index === cursor) return "●";
    if (index < cursor) return "━";
    return "─";
  }).join("");

  return `\`\`\`txt\n${bar}\n${formatTime(safeElapsed)} / ${formatTime(totalSeconds)} • left ${formatTime(remainingSeconds)}\n\`\`\``;
}
