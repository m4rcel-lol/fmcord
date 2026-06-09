type LogLevel = "debug" | "info" | "warn" | "error";

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function getLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function scrubSecrets(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const token = process.env.DISCORD_TOKEN;
  if (!token) return value;
  return value.replaceAll(token, "[REDACTED_TOKEN]");
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  const current = getLevel();
  if (weights[level] < weights[current]) return;

  const timestamp = new Date().toISOString();
  const safeMessage = scrubSecrets(message);
  if (meta === undefined) {
    console[level === "debug" ? "log" : level](`[${timestamp}] [${level.toUpperCase()}] ${safeMessage}`);
    return;
  }

  console[level === "debug" ? "log" : level](
    `[${timestamp}] [${level.toUpperCase()}] ${safeMessage}`,
    scrubSecrets(typeof meta === "string" ? meta : JSON.stringify(meta, null, 2))
  );
}

export const logger = {
  debug: (message: string, meta?: unknown) => log("debug", message, meta),
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta)
};
