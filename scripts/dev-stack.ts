import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type ServiceName = "main" | "worker";

type ServiceConfig = {
  name: ServiceName;
  cwd: string;
  command: string;
  args: string[];
};

type RunningService = {
  config: ServiceConfig;
  child: ChildProcessWithoutNullStreams;
  restarts: number;
};

const rootDir = process.cwd();
const services: ServiceConfig[] = [
  {
    name: "main",
    cwd: rootDir,
    command: "bun",
    args: ["run", "dev"],
  },
  {
    name: "worker",
    cwd: rootDir,
    command: "bun",
    args: ["run", "--watch", "src/server/workers/index.ts"],
  },
];

const running = new Map<ServiceName, RunningService>();
let shuttingDown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function now(): string {
  return new Date().toISOString();
}

function log(service: ServiceName, message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[${now()}][${service}] ${message}`, meta);
    return;
  }
  console.log(`[${now()}][${service}] ${message}`);
}

function spawnService(config: ServiceConfig, restarts = 0): void {
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    env: process.env,
    stdio: "pipe",
  });

  running.set(config.name, { config, child, restarts });
  log(config.name, "started", { pid: child.pid, cwd: config.cwd });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${config.name}] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${config.name}] ${chunk.toString()}`);
  });

  child.on("exit", (code, signal) => {
    const nextRestartCount = restarts + 1;
    running.delete(config.name);

    log(config.name, "exited", { code, signal, restartCount: nextRestartCount });
    if (shuttingDown) return;

    const delayMs = Math.min(2000 * nextRestartCount, 15000);
    log(config.name, "restarting after delay", { delayMs });
    void sleep(delayMs).then(() => {
      if (shuttingDown) return;
      spawnService(config, nextRestartCount);
    });
  });

  child.on("error", (error) => {
    log(config.name, "process error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function checkHealth(): Promise<void> {
  const checks = [
    { label: "main", url: "http://localhost:3000/api/health" },
    { label: "worker", url: "http://localhost:3400/health" },
  ] as const;

  for (const check of checks) {
    try {
      const response = await fetch(check.url);
      if (!response.ok) {
        console.error(`[health] ${check.label} unhealthy`, { status: response.status, url: check.url });
        continue;
      }

      if (check.label === "worker") {
        const payload = (await response.json()) as {
          status?: string;
          platforms?: { slack?: { started?: boolean; lastError?: string | null } };
        };
        console.log("[health] worker", {
          status: payload.status ?? "unknown",
          slackStarted: payload.platforms?.slack?.started ?? false,
          slackLastError: payload.platforms?.slack?.lastError ?? null,
        });
      } else {
        console.log("[health] main", { status: response.status });
      }
    } catch (error) {
      console.error(`[health] ${check.label} check failed`, {
        url: check.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev-stack] received ${signal}, shutting down children...`);

  for (const service of running.values()) {
    try {
      service.child.kill("SIGTERM");
    } catch (error) {
      console.error("[dev-stack] failed to stop child", {
        name: service.config.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await sleep(700);
  for (const service of running.values()) {
    if (!service.child.killed) {
      try {
        service.child.kill("SIGKILL");
      } catch {
        // no-op
      }
    }
  }
  process.exit(0);
}

for (const service of services) {
  spawnService(service);
}

const healthTimer = setInterval(() => {
  void checkHealth();
}, 15000);

process.on("SIGINT", () => {
  clearInterval(healthTimer);
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  clearInterval(healthTimer);
  void shutdown("SIGTERM");
});
