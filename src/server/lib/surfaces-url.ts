import { env } from "@/env";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isSurfacesWorkerEnabled(): boolean {
  return parseBoolean(process.env.SURFACES_WORKER_ENABLED, true);
}

export function getSurfacesBaseUrl(): string | null {
  if (env.SURFACES_API_URL) {
    return env.SURFACES_API_URL.replace(/\/$/, "");
  }

  if (!isSurfacesWorkerEnabled()) {
    return null;
  }

  const port = Number.parseInt(process.env.SURFACES_WORKER_PORT ?? "3400", 10);
  const normalized = Number.isFinite(port) ? port : 3400;
  return `http://127.0.0.1:${normalized}`;
}
