import { formatTime } from "../utils/formatTime";

export function makeProgressBar(elapsedSeconds: number, totalSeconds?: number | null, size = 18): string {
  if (!totalSeconds || totalSeconds <= 0) return "🔴 Live stream";

  const safeElapsed = Math.max(0, Math.min(elapsedSeconds, totalSeconds));
  const ratio = safeElapsed / totalSeconds;
  const cursor = Math.min(size - 1, Math.max(0, Math.round(ratio * (size - 1))));
  const chars = Array.from({ length: size }, (_, index) => (index === cursor ? "🔘" : "▬"));
  return `${chars.join("")} ${formatTime(safeElapsed)} / ${formatTime(totalSeconds)}`;
}
