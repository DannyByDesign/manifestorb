function surfacesWorkerEnabled(): boolean {
  const raw = process.env.SURFACES_WORKER_ENABLED;
  if (!raw) return true;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

if (surfacesWorkerEnabled()) {
  const { startSurfacesWorker } = await import("./surfaces/index");
  if (process.env.NODE_ENV !== "test") {
    void startSurfacesWorker();
  }
}

export {};
