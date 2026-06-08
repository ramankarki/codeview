export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Creates a prefixed logger for a given module.
 */
export function createLogger(prefix: string): Logger {
  return {
    info(msg, data) {
      console.log(`[${prefix}] INFO: ${msg}`, data ?? "");
    },
    warn(msg, data) {
      console.warn(`[${prefix}] WARN: ${msg}`, data ?? "");
    },
    error(msg, data) {
      console.error(`[${prefix}] ERROR: ${msg}`, data ?? "");
    },
  };
}
