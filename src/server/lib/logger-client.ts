/** biome-ignore-all lint/suspicious/noConsole: we use console.log for development logs */

/**
 * Client-safe logger that uses console logging.
 */
export function createClientLogger(scope: string) {
  return {
    info: (message: string, args?: Record<string, unknown>) =>
      console.log(`[${scope}]:`, message, args ?? ""),
    error: (message: string, args?: Record<string, unknown>) =>
      console.error(`[${scope}]:`, message, args ?? ""),
    warn: (message: string, args?: Record<string, unknown>) =>
      console.warn(`[${scope}]:`, message, args ?? ""),
    flush: () => Promise.resolve(),
  };
}
