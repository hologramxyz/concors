/** One JSON line per event on stdout; journald keeps them. */
export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

function serialise(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value;
  }
  return out;
}

export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(line + "\n"),
  minimumLevel = "info",
): Logger {
  const levels = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
  const emit = (level: string, fields: Record<string, unknown>, message: string) => {
    if (levels.indexOf(level) >= levels.indexOf(minimumLevel))
      write(
        JSON.stringify({ level, time: new Date().toISOString(), ...serialise(fields), message }),
      );
  };
  return {
    info: (fields, message) => emit("info", fields, message),
    warn: (fields, message) => emit("warn", fields, message),
    error: (fields, message) => emit("error", fields, message),
  };
}
